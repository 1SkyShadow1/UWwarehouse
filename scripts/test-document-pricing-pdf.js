const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const test=require('node:test');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const start=server.indexOf('const pdfText ='),end=server.indexOf('const safeDocumentId =',start);
assert(start>=0&&end>start);
const renderer=server.slice(start,end)+'\nthis.renderPdf=createDocumentPdf;';
let rendered=[];
class CapturedPdf extends EventEmitter{
  constructor(){super();this.y=40;rendered=[];}
  text(value){rendered.push(String(value));this.y+=10;return this;}
  font(){return this;} fontSize(){return this;} fillColor(){return this;}
  moveTo(){return this;} lineTo(){return this;} strokeColor(){return this;}
  lineWidth(){return this;} stroke(){return this;} image(){return this;}
  heightOfString(){return 18;} addPage(){this.y=40;return this;}
  end(){this.emit('data',Buffer.from('%PDF-test'));this.emit('end');}
}
function loadRenderer(PDFDocument){
  const context=vm.createContext({PDFDocument,Buffer,path,fs,publicDir:path.join(__dirname,'..','public')});
  vm.runInContext(renderer,context);return context.renderPdf;
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
