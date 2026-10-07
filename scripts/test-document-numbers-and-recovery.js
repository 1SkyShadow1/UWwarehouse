const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const {recoverImportedQuotes}=require('../public/js/imported-quotes');
const bundle=JSON.parse(fs.readFileSync(path.join(root,'public/imported-data.js'),'utf8').split('window.UW_IMPORTED=')[1].trim().replace(/;$/,''));
function numbers(){const c=vm.createContext({today:()=> '2026-10-07',DB:{invoices:[],quotes:[]}});for(const name of ['quote-history','document-numbers'])vm.runInContext(fs.readFileSync(path.join(root,'public/js',name+'.js'),'utf8'),c);return c;}
test('compact BB/SS numbers use document date, independent daily sequences and collision detection',()=>{
  const c=numbers();assert.equal(c.nextInvoiceNo(),'BB26100701');assert.equal(c.nextQuoteNo('2026-10-07','SS'),'SS26100701');
  c.DB.invoices=[{id:'BB26100701'},{id:'BB26100703'},{id:'BB07102601'},{id:'SS26100705'}];
  assert.equal(c.nextInvoiceNo(),'BB26100704');assert.equal(c.nextInvoiceNo('2026-10-07','SS'),'SS26100706');assert.equal(c.nextQuoteNo(),'BB26100701');assert.equal(c.nextInvoiceNo('2026-10-08'),'BB26100801');
  assert.equal(c.nextInvoiceNo('2026-02-30'),'');assert.equal(c.validQuoteNo('BB26100701','2026-10-07'),true);assert.equal(c.validInvoiceNo('EE26100701','2026-10-07'),false);assert.equal(c.validInvoiceNo('BB26100801','2026-10-07'),false);assert.equal(c.validQuoteNo('BB26100700','2026-10-07'),false);
  c.DB.quotes=[{id:'SS26100799'}];assert.equal(c.nextQuoteNo('2026-10-07','SS'),'SS261007100');
});
test('all 71 bundled quotes have real introductions and 240 source lines',()=>{
  assert.equal(bundle.quotes.length,71);assert.equal(bundle.quotes.reduce((n,q)=>n+q.items.length,0),240);
  for(const q of bundle.quotes){assert(q.customer&&q.introduction&&q.sourceWorkbook);assert(!/^Imported/i.test(q.customer));assert(!/Imported from/i.test(q.notes));assert(q.items.every(i=>i.desc&&!/^Imported/i.test(i.desc)));}
  const q=bundle.quotes.find(q=>q.id==='BB10062501');assert.equal(q.items.length,4);assert.equal(q.items.reduce((sum,i)=>sum+i.qty*i.price,0),8470);assert(q.introduction.includes('Scatter Cushions'));
});
test('source recovery is idempotent, does not resurrect deleted quotes or overwrite manual edits',()=>{
  const source=bundle.quotes.find(q=>q.id==='BB10062501');const data={quotes:[{id:source.id,customer:'Imported quote',status:'Imported',notes:'Imported from x',introduction:'Imported from x',items:[{desc:'Imported quote',qty:1,price:45848}]}],invoices:[{id:'legacy'}]};
  assert.equal(recoverImportedQuotes(data,bundle.quotes),1);assert.equal(data.quotes.length,1);assert.equal(data.quotes[0].items.length,4);assert.equal(data.invoices[0].id,'legacy');assert.equal(recoverImportedQuotes(data,bundle.quotes),0);
  data.quotes[0].introduction='';assert.equal(recoverImportedQuotes(data,bundle.quotes),0);assert.equal(data.quotes[0].introduction,'');
  const manual={quotes:[{id:source.id,customer:'My client',introduction:'My text',items:[{desc:'My line',qty:1,price:9}],expiry:'2027-01-01'}]};recoverImportedQuotes(manual,bundle.quotes);assert.equal(manual.quotes[0].items[0].price,9);assert.equal(manual.quotes[0].customer,'My client');assert.equal(manual.quotes[0].introduction,'My text');
});
test('missing source rates remain blank and alternative quotes require explicit price review',()=>{
  const blank=bundle.quotes.find(q=>q.id==='MG27022401');assert.equal(blank.items.find(i=>i.desc==='Bed box').price,'');
  const options=bundle.quotes.find(q=>q.id==='RP03022501');assert(options.items.some(i=>i.desc.startsWith('OR\n')));assert(options.sourcePricingWarnings.some(w=>w.includes('alternative')));
});
test('server startup repairs placeholders once through the existing ledger and preserves unrelated records',async()=>{
  const os=require('node:os'),{spawn}=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'uw-quote-repair-')),stateFile=path.join(dir,'uw-state.json'),port=52000+Math.floor(Math.random()*5000);
  const original={version:1,revision:7,updatedAt:'2026-10-01T00:00:00Z',data:{quotes:[{id:'BB10062501',customer:'Imported quote',items:[{desc:'Imported quote',qty:1,price:45848}],notes:'Imported from source',status:'Imported'}],invoices:[{id:'OLD',customer:'Keep',items:[{desc:'Work',qty:1,price:99}],paid:30}],meta:{sentinel:'unchanged'}}};
  fs.writeFileSync(stateFile,JSON.stringify(original));
  const env={...process.env,NODE_ENV:'test',UW_LOCAL_ONLY:'1',HOST:'127.0.0.1',PORT:String(port),UW_DATA_DIR:dir,UW_DOCUMENTS_DIR:path.join(dir,'documents'),UW_INVOICES_DIR:path.join(dir,'invoices'),UW_QUOTES_DIR:path.join(dir,'quotes'),UW_API_KEY:'quote-test-key',UW_AUTH_USERS_JSON:'{}',SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:''};
  async function start(){const child=spawn(process.execPath,[path.join(root,'server.js')],{env,stdio:'ignore',windowsHide:true});try{for(let i=0;i<80;i++){if(child.exitCode!==null)throw Error('Server failed startup');try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)return child;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}throw Error('Server startup timeout');}catch(error){child.kill();throw error;}}
  let child=await start();
  try{const current=JSON.parse(fs.readFileSync(stateFile));assert.equal(current.revision,8);assert.equal(current.data.quotes[0].items.length,4);assert.deepEqual(current.data.invoices,original.data.invoices);assert.deepEqual(current.data.meta,original.data.meta);assert.equal(JSON.parse(fs.readFileSync(stateFile+'.bak')).revision,7);}
  finally{child.kill();await new Promise(resolve=>child.once('exit',resolve));}
  child=await start();try{assert.equal(JSON.parse(fs.readFileSync(stateFile)).revision,8);}finally{child.kill();}
});
