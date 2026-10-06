const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const test=require('node:test');
const {documentRenderer}=require('../lib/document-pdf');
let rendered=[];
class CapturedPdf extends EventEmitter{
  constructor(){super();this.y=40;rendered=[];}
  text(value){rendered.push(String(value));this.y+=10;return this;}
  font(){return this;} fontSize(){return this;} fillColor(){return this;}
  moveTo(){return this;} lineTo(){return this;} strokeColor(){return this;}
  rect(){return this;} lineWidth(){return this;} stroke(){return this;} image(){return this;}
  heightOfString(){return 18;} addPage(){this.y=40;return this;}
  end(){this.emit('data',Buffer.from('%PDF-test'));this.emit('end');}
}
function loadRenderer(PDFDocument){
  return documentRenderer(PDFDocument,path.join(__dirname,'..','public'));
}
const record={id:'QA-QUOTE',revision:3,date:'2026-10-05',expiry:'2026-11-19',customer:'PDF review client',items:[{desc:'Helm fabric',item:'Fabric',qty:2.5,price:127.5,unitCost:987654321,markupPercent:54321}],introduction:'Reupholster the guest chairs.'};
test('PDF quote uses actual revision and validity and prints only selling amounts',async()=>{
  await loadRenderer(CapturedPdf)({kind:'quote',record});
  const output=rendered.join('\n');
  assert.match(output,/Revision 3/);assert.match(output,/valid until 2026-11-19/);
  assert(!output.includes('valid for 30 days'));
  assert(!output.includes('987654321')&&!output.includes('54321')&&!/unitCost|markupPercent/.test(output));
  assert(output.includes(Number(318.75).toLocaleString('en-ZA',{minimumFractionDigits:2,maximumFractionDigits:2})));
});
test('historical quote without expiry does not invent a validity period',async()=>{
  await loadRenderer(CapturedPdf)({kind:'quote',record:{...record,expiry:''}});
  assert(rendered.join('\n').includes('validity must be confirmed'));
});
test('invoice rendering keeps internal pricing metadata private',async()=>{
  await loadRenderer(CapturedPdf)({kind:'invoice',record});
  assert(!rendered.join('\n').includes('987654321'));
});
if(process.env.UW_PRICING_PDF_OUTPUT){
  const render=loadRenderer(require('pdfkit'));
  render({kind:'quote',record}).then(bytes=>fs.writeFileSync(process.env.UW_PRICING_PDF_OUTPUT,bytes));
}

test('material descriptions appear once and custom item references do not leak into descriptions',()=>{
  const {documentLineDescription}=require('../public/js/document-format');
  assert.equal(documentLineDescription({item:'Fabric',desc:'Fabric - Fabric - Prasa'}),'Fabric - Prasa');
  assert.equal(documentLineDescription({item:'Foam',desc:'Foam - Foam - Yellow'}),'Foam - Yellow');
  assert.equal(documentLineDescription({item:'Fabric',desc:'Lounge suite - Fabric Stone'}),'Lounge suite - Fabric Stone');
  assert.equal(documentLineDescription({item:'STOCK-123',desc:'High density foam'}),'High density foam');
});

test('real PDFs paginate long records and very long descriptions',async()=>{
  const PDFDocument=require('pdfkit'),{PDFDocument:Reader}=require('pdf-lib');
  const render=loadRenderer(PDFDocument);
  const many={...record,items:Array.from({length:65},(_,i)=>({item:'Labour',desc:`Distinct work line ${i+1}: strip and prepare the chair frame`,qty:2,price:195}))};
  for(const kind of ['invoice','quote']){
    const document=await Reader.load(await render({kind,record:many}));assert(document.getPageCount()>1);
    const huge=await Reader.load(await render({kind,record:{...record,items:[{desc:'Long specification '.repeat(1400),qty:1,price:195}]}}));assert(huge.getPageCount()>1);
  }
});
