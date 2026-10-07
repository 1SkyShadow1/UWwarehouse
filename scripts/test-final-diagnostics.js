const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
function load(context,files){vm.createContext(context);for(const file of files)vm.runInContext(fs.readFileSync(path.join(root,'public/js',file+'.js'),'utf8'),context);return context;}
test('local document dates and report months do not shift to the previous UTC day',()=>{
  const c=vm.createContext({Date:class {getFullYear(){return 2026;}getMonth(){return 9;}getDate(){return 1;}toISOString(){return '2026-09-30T22:30:00.000Z';}}});
  const start=html.indexOf('function localCalendarDate('),end=html.indexOf('const today =',start);
  vm.runInContext(html.slice(start,end)+"globalThis.currentDay=localCalendarDate();",c);assert.equal(c.currentDay,'2026-10-01');
  c.Date=class extends Date {constructor(...args){super(...(args.length?args:[2026,9,7,12]));}};c.state={mfilter:''};
  vm.runInContext(html.slice(html.indexOf('function monthFilterHtml('),html.indexOf('let state={mfilter:')),c);
  const filter=c.monthFilterHtml('fixture');assert.match(filter,/value="2026-10"/);assert.match(filter,/value="2024-01"/);assert(!filter.includes('value="2023-12"'));
});
test('periodic cache saves log only actual failures and queue pending changes',()=>{
  let errors=0,queued=0,result={ok:true};
  const c=vm.createContext({DB:{meta:{}},writeLocalSnapshot:()=>result,queueServerStateSave:()=>queued++,console:{error:()=>errors++}});
  vm.runInContext(html.slice(html.indexOf('function persistLocalSnapshot(){'),html.indexOf('function startPeriodicSync(){')),c);
  c.persistLocalSnapshot();assert.equal(errors,0);assert.equal(queued,0);
  c.DB.meta.syncPending=true;c.persistLocalSnapshot();assert.equal(queued,1);
  result={ok:false,error:Error('Cache unavailable')};c.persistLocalSnapshot();assert.equal(errors,1);assert.equal(queued,1);
});
test('document export failures survive a successful shared save and Global Save reports partial success',async()=>{
  const messages=[],statuses=[],exportErrors=['Disk unavailable'];
  const c=vm.createContext({DB:{meta:{}},serverSyncTimer:null,serverSyncPending:false,serverSyncAvailable:true,serverSyncInFlight:false,serverSyncPromise:null,serverSyncError:null,serverConflict:null,serverRevision:0,serverRetryTimer:null,serverRetryAttempt:0,sharedSyncBase:null,cacheSharedBaseline:()=>{},sharedSyncStatus:s=>statuses.push(s),writeLocalSnapshot:()=>({ok:true}),fetch:async()=>({ok:true,status:200,json:async()=>({revision:1,documentExports:{errors:exportErrors}})}),toast:s=>messages.push(s),console:{error:()=>{}},setTimeout,clearTimeout,localServerOnly:true,save:()=>true,document:{getElementById:()=>null}});
  vm.runInContext(html.slice(html.indexOf('function queueServerStateSave(){'),html.indexOf('async function resolveStateConflict(choice){')),c);
  const result=await c.syncServerState(true,true);assert.equal(result.serverSaved,true);assert.deepEqual(result.documentExportErrors,exportErrors);assert.match(statuses.at(-1),/export needs attention/);
  vm.runInContext(html.slice(html.indexOf('async function globalSave(){'),html.indexOf('function persistLocalSnapshot(){')),c);
  await c.globalSave();assert.match(messages.at(-1),/PDF could not be saved/);assert(!messages.some(s=>s.includes('shared workspace updated')));
});
test('editing dates enforces current document numbers while keeping historical identifiers',()=>{
  const fields={},messages=[],invoice={id:'BB26100701',date:'2026-10-07',customer:'Customer',items:[{desc:'Work',qty:1,price:10}]};let saves=0;
  const c=load({DB:{invoices:[invoice],quotes:[]},today:()=> '2026-10-07',fa:id=>fields[id]||'',toast:s=>messages.push(s),collectDocumentItems:()=>invoice.items,save:()=>saves++,closeModal:()=>{},render:()=>{}},['quote-history','document-numbers','document-editor','quotes']);
  Object.assign(fields,{'ef-no':invoice.id,'ef-date':'2026-10-08','ef-cust':'Customer'});c.saveEditedInvoice(invoice.id);assert.equal(saves,0);assert.equal(invoice.date,'2026-10-07');
  fields['ef-no']='BB26100801';fields['ef-due']='2026-10-07';c.saveEditedInvoice(invoice.id);assert.equal(saves,0);assert.match(messages.at(-1),/payment due date/);
  fields['ef-due']='2026-10-10';c.saveEditedInvoice(invoice.id);assert.equal(saves,1);assert.equal(invoice.id,'BB26100801');
  invoice.id='BB10062501';invoice.date='2025-06-10';fields['ef-no']=invoice.id;fields['ef-date']=invoice.date;fields['ef-due']='';c.saveEditedInvoice(invoice.id);assert.equal(saves,2);
  c.DB.invoices.push({...invoice,sourceWorkbook:'second source'});c.saveEditedInvoice(invoice.id);assert.equal(saves,3,'An unchanged historical number must remain editable when source copies exist');
  const quote={id:'SS26100701',date:'2026-10-07',items:invoice.items};c.DB.quotes=[quote];Object.assign(fields,{'eq-no':quote.id,'eq-date':'2026-10-08','eq-cust':'Customer'});c.saveEditedQuote(quote.id);assert.equal(saves,3);assert.equal(quote.date,'2026-10-07');
});
test('month-end export counts each invoice once and includes deposits in collected income',()=>{
  let output;
  const original={id:'A',date:'2026-10-07',paid:30,deposit:20,items:[{qty:2,price:100}]};
  const c=vm.createContext({DB:{invoices:[original,{...original,sourceWorkbook:'second source'}],expenses:[{date:'2026-10-07',amount:10}]},monthOf:d=>d.slice(0,7),uniqueExpenses:e=>e,today:()=> '2026-10-07',toast:()=>{},Blob:class{constructor(parts){output=parts.join('');}},URL:{createObjectURL:()=> 'fixture'},document:{createElement:()=>({click:()=>{}})}});
  vm.runInContext(html.slice(html.indexOf('const invTotal ='),html.indexOf('function toast(msg)')),c);
  vm.runInContext(html.slice(html.indexOf('function exportMonthSummary(){'),html.indexOf('/* ---------- GALLERY ---------- */')),c);
  c.exportMonthSummary();assert.equal(output,'Month,Invoiced,Collected,Expenses,Net\n2026-10,200,50,10,40\n');assert.equal(c.DB.invoices.length,2,'Read-only reporting must preserve source records');
});
