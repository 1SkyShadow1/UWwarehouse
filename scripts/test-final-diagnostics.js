const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
function load(context,files){vm.createContext(context);for(const file of files)vm.runInContext(fs.readFileSync(path.join(root,'public/js',file+'.js'),'utf8'),context);return context;}
test('local document dates and report months do not shift to the previous UTC day',()=>{
  const c=vm.createContext({Date:class {getFullYear(){return 2026;}getMonth(){return 9;}getDate(){return 1;}toISOString(){return '2026-09-30T22:30:00.000Z';}}});
  const start=html.indexOf('function localCalendarDate('),end=html.indexOf('const today =',start);
  vm.runInContext(html.slice(start,end)+"globalThis.currentDay=localCalendarDate();",c);assert.equal(c.currentDay,'2026-10-01');
  c.Date=class extends Date {constructor(...args){super(...(args.length?args:[2026,9,7,12]));}};c.state={mfilter:''};c.today=()=>c.localCalendarDate();
  vm.runInContext(html.slice(html.indexOf('function monthFilterHtml('),html.indexOf('let state={mfilter:')),c);
  const filter=c.monthFilterHtml('fixture');assert.match(filter,/value="2026-10"/);assert.match(filter,/value="2024-01"/);assert(!filter.includes('value="2023-12"'));
  assert.match(filter,/value="year:2026"/);assert.match(filter,/value="year:2025"/);assert.match(filter,/value="ytd:2026"/);
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
  const c=load({DB:{invoices:[invoice],quotes:[],receipts:[],jobs:[],meta:{}},today:()=> '2026-10-07',fa:id=>fields[id]||'',toast:s=>messages.push(s),collectDocumentItems:()=>invoice.items,registerDocumentItemPresets:items=>items,save:()=>{saves++;return true;},closeModal:()=>{},render:()=>{}},['quote-history','document-numbers','document-editor','quotes']);
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

test('startup migrations never write a whole ledger to quota-limited localStorage',()=>{
  const startup=html.slice(html.indexOf('function load(){'),html.indexOf('let cloudSyncTimer,'));
  assert(!startup.includes('localStorage.setItem(DB_KEY'));
  const wages=html.slice(html.indexOf('const normalizeWageLedger ='),html.indexOf('normalizeWageLedger(DB);'));
  assert(!wages.includes('localStorage.setItem(DB_KEY'));
});

test('large job lists load invoice choices on demand and retain linked invoice IDs',()=>{
  const invoices=Array.from({length:512},(_,index)=>({id:'INV-'+(index%384)}));
  const jobs=Array.from({length:100},(_,index)=>({id:'JOB-'+index,invoiceId:'INV-'+index,stage:'Quoted'}));
  const c=vm.createContext({DB:{invoices,jobs,quotes:[]},uniqueQuotes:()=>[],state:{},R:String,escapeHtml:String,invBalance:()=>0,invTotal:()=>10,
    Option:class{constructor(text,value,defaultSelected,selected){Object.assign(this,{text,value,selected});}}});
  vm.runInContext(fs.readFileSync(path.join(root,'public/js/job-production.js'),'utf8'),c);
  vm.runInContext(html.slice(html.indexOf('function populateJobInvoiceOptions('),html.indexOf('function updateJobStage(')),c);
  const target={};c.vJobs(target);
  assert((target.innerHTML.match(/<option/g)||[]).length<2000,'Initial rendering must not build an invoice catalogue for every job');
  const select={dataset:{},value:'INV-47',replaceChildren(...options){this.options=options;}};
  c.populateJobInvoiceOptions(select);
  assert.equal(select.options.length,385);assert.equal(select.value,'INV-47');
  assert.equal(select.options.filter(option=>option.selected).length,1);
  const original=select.options;c.populateJobInvoiceOptions(select);assert.equal(select.options,original);
  assert.equal(invoices.length,512,'Source invoice rows must be retained');
});

test('document register renders managed scans without source paths and approves the selected ID only',()=>{
  const scans=[{id:'scan-a',name:'first.pdf',managedDocumentId:'managed-a',canonical:true},{id:'scan-b',name:'second.pdf',managedDocumentId:'managed-b',canonical:true}];
  let saves=0;
  const c=vm.createContext({DB:{documents:[{id:'source',name:'upload.pdf',url:'/api/documents/source'}],filesystemFiles:[],scannedDocuments:scans},scannedRows:()=>scans,scannedCategory:()=> 'Receipt scan',sortDocumentsByDate:x=>x,docMatches:()=>true,docFilterHtml:()=>'',escapeHtml:String,save:()=>saves++,toast:()=>{},render:()=>{},confirm:()=>true});
  vm.runInContext(html.slice(html.indexOf('function vDocuments('),html.indexOf('function vAssistant(')),c);
  const target={};c.vDocuments(target);
  assert.match(target.innerHTML,/first\.pdf/);assert.match(target.innerHTML,/second\.pdf/);assert.match(target.innerHTML,/Managed document storage/);
  assert(!target.innerHTML.includes('undefined'));assert.match(target.innerHTML,/Unclassified/);
  assert.match(target.innerHTML,/approveDocument\("","scan-b"\)/);
  vm.runInContext(html.slice(html.indexOf('function approveDocument('),html.indexOf('function scannedRows(')),c);
  c.approveDocument('', 'scan-b');assert.equal(scans[1].reviewStatus,'Approved');assert.equal(scans[0].reviewStatus,undefined);assert.equal(saves,1);
  c.approveDocument('');assert.equal(saves,1,'Missing identifiers must never match another pathless record');
});

test('payments and receipts reject overpayment and preserve prior deposits',()=>{
  const invoice={id:'INV',customer:'Client',items:[{qty:1,price:100}],paid:10,deposit:20,status:'Pending'};
  const inputs={'p-amt':{value:'70.01'},'p-date':{value:'2026-10-23'},'p-prefix':{value:'BB'},'p-m':{value:'EFT'},'r-date':{value:'2026-10-23'},'r-no':{value:'BB2026/10/2301'},'r-cust':{value:'Client'},'r-inv':{value:'INV'},'r-amt':{value:'70.01'},'r-m':{value:'EFT'}};
  const messages=[];let saves=0;
  const c=vm.createContext({DB:{invoices:[invoice],receipts:[],counters:{receipt:0},meta:{fy:'2026'}},document:{getElementById:id=>inputs[id]},invTotal:item=>item.items.reduce((sum,line)=>sum+line.qty*line.price,0),invBalance:item=>item.items.reduce((sum,line)=>sum+line.qty*line.price,0)-(item.paid||0)-(item.deposit||0),nextReceiptNo:()=> 'BB2026/10/2302',validReceiptNo:()=>true,save:()=>{saves++;return true;},closeModal:()=>{},toast:message=>messages.push(message),render:()=>{}});
  vm.runInContext(html.slice(html.indexOf('function savePay('),html.indexOf('function viewInvoiceLegacy(')),c);
  vm.runInContext(html.slice(html.indexOf('function saveReceipt('),html.indexOf('function viewReceipt(')),c);
  c.savePay('INV');assert.equal(invoice.paid,10);assert.equal(c.DB.receipts.length,0);assert.match(messages.at(-1),/no more than the invoice balance/);
  inputs['p-amt'].value='70';c.savePay('INV');assert.equal(invoice.paid,80);assert.equal(invoice.deposit,20);assert.equal(c.DB.receipts.length,1);assert.equal(saves,1);
  invoice.paid=10;invoice.deposit=20;inputs['r-amt'].value='70.01';c.saveReceipt();assert.equal(invoice.paid,10);assert.equal(c.DB.receipts.length,1);
  inputs['r-amt'].value='70';c.saveReceipt();assert.equal(invoice.paid,80);assert.equal(invoice.deposit,20);assert.equal(c.DB.receipts.length,2);
  invoice.paid=10;invoice.deposit=20;invoice.status='Pending';c.DB.receipts=[];c.DB.counters.receipt=0;c.save=()=>false;inputs['p-amt'].value='70';c.savePay('INV');
  assert.equal(invoice.paid,10);assert.equal(invoice.status,'Pending');assert.equal(c.DB.receipts.length,0);assert.equal(c.DB.counters.receipt,0);
  inputs['r-amt'].value='70';c.saveReceipt();assert.equal(invoice.paid,10);assert.equal(c.DB.receipts.length,0);assert.equal(c.DB.counters.receipt,0);
});

test('quote deletion cascades atomically only for unpaid quotes with unstarted jobs',()=>{
  const quote={id:'Q1',invoiceId:'I1'},invoice={id:'I1',generatedFromQuote:'Q1',items:[{qty:1,price:50}]},job={id:'J1',quoteId:'Q1',invoiceId:'I1',stage:'Quoted'};
  const makeContext=(receiptRows=[],stageJob=job)=>{const messages=[];let saves=0;const context=vm.createContext({DB:{quotes:[quote],invoices:[invoice],jobs:[stageJob],receipts:receiptRows},invoiceCollectedAmount:item=>(item.paid||0)+(item.deposit||0),invBalance:()=>0,R:String,confirm:()=>true,save:()=>{saves++;return true;},render:()=>{},toast:message=>messages.push(message)});vm.runInContext(html.slice(html.indexOf('function quoteDeletionLinks('),html.indexOf('/* ---------- RECEIPTS ---------- */')),context);return {context,messages,get saves(){return saves;}};};
  const safe=makeContext();safe.context.del('quotes','Q1');assert.equal(safe.context.DB.quotes.length,0);assert.equal(safe.context.DB.invoices.length,0);assert.equal(safe.context.DB.jobs.length,0);assert.equal(safe.saves,1);
  const failed=makeContext();failed.context.save=()=>false;failed.context.del('quotes','Q1');assert.equal(failed.context.DB.quotes.length,1);assert.equal(failed.context.DB.invoices.length,1);assert.equal(failed.context.DB.jobs.length,1);
  const paid=makeContext([{invoiceId:'I1',amount:1}]);paid.context.del('quotes','Q1');assert.equal(paid.context.DB.quotes.length,1);assert.equal(paid.context.DB.invoices.length,1);assert.equal(paid.context.DB.jobs.length,1);assert.equal(paid.saves,0);assert.match(paid.messages.at(-1),/payment or receipt history/);
  const active=makeContext([],{...job,stage:'In production',productionStartedAt:'2026-10-23T09:00:00.000Z'});active.context.del('quotes','Q1');assert.equal(active.context.DB.quotes.length,1);assert.equal(active.saves,0);assert.match(active.messages.at(-1),/production history/);
});

test('invoice deletion guards linked financial records and receipt deletion reverses payment',()=>{
  const invoice={id:'I1',items:[{qty:1,price:100}],paid:30,deposit:10,status:'Pending'},receipt={id:1,receiptNo:'R1',invoiceId:'I1',amount:20};
  let confirms=0,saves=0;const messages=[];
  const c=vm.createContext({DB:{quotes:[],invoices:[invoice],jobs:[],receipts:[receipt]},invoiceCollectedAmount:item=>(item.paid||0)+(item.deposit||0),invBalance:item=>item.items[0].qty*item.items[0].price-(item.paid||0)-(item.deposit||0),R:value=>String(value),confirm:()=>{confirms++;return true;},save:()=>{saves++;return true;},render:()=>{},toast:message=>messages.push(message)});
  vm.runInContext(html.slice(html.indexOf('function quoteDeletionLinks('),html.indexOf('/* ---------- RECEIPTS ---------- */')),c);
  c.del('invoices','I1');assert.equal(c.DB.invoices.length,1);assert.equal(confirms,0);assert.equal(saves,0);assert.match(messages.at(-1),/payment or receipt history/);
  c.deleteReceipt(1);assert.equal(c.DB.receipts.length,0);assert.equal(invoice.paid,10);assert.equal(invoice.deposit,10);assert.equal(c.invBalance(invoice),80);assert.equal(saves,1);
});

test('skipping production stages requires confirmation and every change is audited',()=>{
  const job={id:'J1',stage:'Quoted'},db={jobs:[job],quotes:[],invoices:[]},messages=[];let saves=0,confirmResult=false,renders=0;
  const c=vm.createContext({DB:db,toast:message=>messages.push(message),save:()=>{saves++;return true;},render:()=>renders++,confirm:()=>confirmResult});
  vm.runInContext(fs.readFileSync(path.join(root,'public/js/job-production.js'),'utf8'),c);
  vm.runInContext(html.slice(html.indexOf('function jobHasAdvancedProduction('),html.indexOf('function populateNewJobFromSource(')),c);
  c.updateJobStage('J1','Ready for collection',0);assert.equal(job.stage,'Quoted');assert.equal(saves,0);assert.equal(renders,1);
  confirmResult=true;c.updateJobStage('J1','Ready for collection',0);assert.equal(job.stage,'Ready for collection');assert.deepEqual(Array.from(job.stageHistory).map(entry=>entry.to),['Ready for collection']);assert.equal(saves,1);
});

test('virtual quote jobs do not persist when a skipped-stage change is cancelled',()=>{
  const quote={id:'Q1',status:'Draft'},db={jobs:[],quotes:[quote],invoices:[]};let confirmResult=false,saves=0;
  const c=vm.createContext({DB:db,toast:()=>{},save:()=>{saves++;return true;},render:()=>{},confirm:()=>confirmResult});
  vm.runInContext(fs.readFileSync(path.join(root,'public/js/job-production.js'),'utf8'),c);
  vm.runInContext(html.slice(html.indexOf('function jobHasAdvancedProduction('),html.indexOf('function populateNewJobFromSource(')),c);
  c.updateJobStage('Q1','In production',-1);assert.equal(db.jobs.length,0);assert.equal(saves,0);
});

test('manual jobs can be populated from quotes and linked without duplicating an existing job',()=>{
  const quote={id:'Q1',customer:'Client',projectReference:'Lounge',date:'2026-10-23',workType:'Reupholster',colour:'Navy',introduction:'Recover cushions.',items:[]};
  const fields={};for(const id of ['j-id','j-quote','j-invoice','j-cust','j-project','j-date','j-work-type','j-colour','j-stage','j-notes'])fields[id]={value:id==='j-id'?'JOB-1':id==='j-quote'?'Q1':id==='j-stage'?'Quoted':''};
  const db={quotes:[quote],invoices:[],jobs:[]};let saves=0,modalHtml='';
  const c=vm.createContext({DB:db,document:{getElementById:id=>fields[id]},uniqueQuotes:()=>db.quotes,uniqueInvoices:()=>db.invoices,escapeHtml:String,today:()=> '2026-10-23',modal:html=>{modalHtml=html;},save:()=>{saves++;return true;},closeModal:()=>{},render:()=>{},toast:()=>{},confirm:()=>true,invBalance:()=>0});
  vm.runInContext(fs.readFileSync(path.join(root,'public/js/job-production.js'),'utf8'),c);
  vm.runInContext(html.slice(html.indexOf('function jobHasAdvancedProduction('),html.indexOf('function viewJob(')),c);
  c.newJob();assert.match(modalHtml,/id="j-quote"/);assert.match(modalHtml,/id="j-invoice"/);
  c.populateNewJobFromSource();assert.equal(fields['j-cust'].value,'Client');assert.equal(fields['j-project'].value,'Lounge');assert.equal(fields['j-date'].value,'2026-10-23');assert.equal(fields['j-notes'].value,'Recover cushions.');
  c.saveNewJob();assert.equal(db.jobs.length,1);assert.equal(db.jobs[0].quoteId,'Q1');assert.equal(db.jobs[0].customer,'Client');assert.equal(saves,1);
  c.saveNewJob();assert.equal(db.jobs.length,1);assert.equal(saves,1);
});

test('invoice edits cannot reduce the total below payment already recorded',()=>{
  const invoice={id:'INV',date:'2026-10-23',customer:'Client',paid:70,deposit:10,items:[{qty:1,price:100}]},messages=[];let saves=0;
  const fields={'ef-no':'INV','ef-date':'2026-10-23','ef-due':'','ef-cust':'Client'};
  const c=vm.createContext({DB:{invoices:[invoice],receipts:[],jobs:[],quotes:[],meta:{}},fa:id=>fields[id]||'',collectDocumentItems:()=>[{qty:1,price:79}],validInvoiceNo:()=>true,validQuoteExpiry:()=>true,registerDocumentItemPresets:items=>items,toast:message=>messages.push(message),save:()=>{saves++;return true;},closeModal:()=>{},render:()=>{}});
  vm.runInContext(fs.readFileSync(path.join(root,'public/js/document-editor.js'),'utf8'),c);
  c.saveEditedInvoice('INV');assert.equal(invoice.items[0].price,100);assert.equal(saves,0);assert.match(messages.at(-1),/cannot be reduced below payments/);
});
