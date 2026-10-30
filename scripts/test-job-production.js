const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
function load(db){
  const context=vm.createContext({DB:db,findFabric:id=>id==='fabric-1'?{desc:'Harbour weave'}:null});
  vm.runInContext(fs.readFileSync(path.join(root,'public/js/job-production.js'),'utf8'),context);
  return context;
}
test('creating or revising a quote keeps one linked production job with current quote details',()=>{
  const db={quotes:[],invoices:[],jobs:[]},c=load(db),quote={id:'BB26102301',date:'2026-10-23',customer:'A Customer',projectReference:'Lounge suite',workType:'Reupholster',colour:'Navy',status:'Draft',items:[{item:'Fabric',fabricId:'fabric-1',desc:'Fabric - Harbour weave',qty:5,unit:'m'}]};
  db.quotes.push(quote);
  const job=c.syncQuoteJob(quote);
  assert.equal(db.jobs.length,1);assert.equal(job.quoteId,quote.id);assert.equal(job.stage,'Quoted');assert.equal(job.intakeDate,quote.date);assert.equal(job.customer,quote.customer);assert.equal(job.project,quote.projectReference);assert.equal(job.workType,quote.workType);assert.equal(job.productionStartedAt,undefined);
  assert.equal(c.syncQuoteJob(quote),job);assert.equal(db.jobs.length,1,'Quote sync must not duplicate its job');
  quote.customer='Updated Customer';quote.projectReference='Dining chairs';quote.id='BB26102302';quote.date='2026-10-24';
  assert.equal(c.syncQuoteJob(quote,'BB26102301'),job);assert.equal(db.jobs.length,1);assert.equal(job.quoteId,quote.id);assert.equal(job.customer,'Updated Customer');assert.equal(job.project,'Dining chairs');assert.equal(job.intakeDate,'2026-10-24');
  assert.equal(c.quoteForJob(job),quote);
  assert.deepEqual(Array.from(c.jobFabricItems(quote)).map(item=>c.jobFabricName(item)),['Harbour weave']);
});
test('job work scope stays on the accepted quote snapshot after a Draft revision',()=>{
  const accepted={id:'Q-1',status:'Accepted',customer:'Client',items:[{desc:'Accepted fabric',qty:1,price:100}]};
  const quote={...accepted,acceptedVersion:{snapshot:JSON.parse(JSON.stringify(accepted))}},db={quotes:[quote],invoices:[],jobs:[]},c=load(db),job=c.syncQuoteJob(quote);
  assert.equal(c.quoteForJob(job).items[0].desc,'Accepted fabric');
  quote.status='Draft';quote.items=[{desc:'Revised draft fabric',qty:2,price:200}];c.syncQuoteJob(quote);
  assert.equal(c.quoteForJob(job).items[0].desc,'Accepted fabric');
  assert.equal(c.quoteForJob(job).items[0].qty,1);
});
test('production duration starts on entry, pauses outside production and accumulates on return',()=>{
  const c=load({quotes:[],invoices:[],jobs:[]}),job={id:'JOB-1',stage:'Quoted',productionElapsedMs:0};
  assert.equal(c.setJobProductionStage(job,'In production','2026-10-22T10:00:00.000Z'),true);
  assert.equal(job.productionStartedAt,'2026-10-22T10:00:00.000Z');
  assert.deepEqual(Array.from(job.stageHistory).map(entry=>[entry.from,entry.to]),[['Quoted','In production']]);
  assert.equal(c.formatJobProductionElapsed(job,Date.parse('2026-10-23T11:30:00.000Z')),'1 day 1 hr');
  assert.equal(c.setJobProductionStage(job,'Quality check','2026-10-23T12:00:00.000Z'),true);
  assert.equal(job.productionElapsedMs,26*60*60*1000);assert.equal(job.productionStartedAt,'');
  assert.equal(c.formatJobProductionElapsed(job,Date.parse('2026-10-25T12:00:00.000Z')),'1 day 2 hrs');
  assert.equal(c.setJobProductionStage(job,'In production','2026-10-25T12:00:00.000Z'),true);
  assert.equal(c.formatJobProductionElapsed(job,Date.parse('2026-10-25T14:00:00.000Z')),'1 day 4 hrs');
  assert.equal(c.setJobProductionStage(job,'Quality check','2026-10-25T14:00:00.000Z'),true);
  assert.equal(job.productionElapsedMs,28*60*60*1000);
  assert.equal(job.stageHistory.length,4,'Every actual stage change should be retained for audit');
  assert.equal(c.formatJobProductionElapsed({stage:'In production'}),'Start date not recorded');
  assert.equal(c.formatJobProductionElapsed({stage:'Quoted'}),'Not started');
});
test('jobs resolve the quote through linked invoices and report quote arrival age',()=>{
  const quote={id:'BB26102201',date:'2026-10-22'},db={quotes:[quote],invoices:[{id:'INV-1',generatedFromQuote:quote.id}],jobs:[]},c=load(db);
  assert.equal(c.quoteForJob({id:'JOB-1',invoiceId:'INV-1'}),quote);
  assert.equal(c.jobDaysSince('2026-10-22',new Date('2026-10-23T12:00:00.000Z')),1);
  assert.equal(c.jobDaysSince('unknown'),null);
});
test('production cards expose customer, intake, work lines, fabric, stage and invoice controls',()=>{
  const quote={id:'BB26102301',date:'2026-10-23',customer:'A Customer',projectReference:'Lounge suite',workType:'Reupholster',colour:'Navy',status:'Draft',introduction:'Recover the two seat cushions.',items:[{item:'Fabric',fabricId:'fabric-1',desc:'Fabric - Harbour weave',qty:5,unit:'m'}]};
  const db={quotes:[quote],invoices:[{id:'INV-1',generatedFromQuote:quote.id}],jobs:[{id:'JOB-BB26102301',quoteId:quote.id,invoiceId:'INV-1',customer:quote.customer,project:quote.projectReference,intakeDate:quote.date,stage:'Quoted',workType:quote.workType}]};
  const c=load(db);c.state={jobStage:'All'};c.uniqueQuotes=()=>db.quotes;c.R=value=>String(value);c.escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');c.invBalance=()=>0;c.invTotal=()=>10;
  const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8'),start=html.indexOf('function populateJobInvoiceOptions('),end=html.indexOf('function vPayables(',start);
  vm.runInContext(html.slice(start,end),c);
  const target={};c.vJobs(target);
  for(const text of ['A Customer','2026-10-23','Recover the two seat cushions.','Harbour weave','Time in production','Invoice link','Full job card','>Print</button>'])assert(target.innerHTML.includes(text),`missing job card detail: ${text}`);
  assert.match(target.innerHTML,/onchange="updateJobStage\(&quot;JOB-BB26102301&quot;/);
  assert.equal((target.innerHTML.match(/class="job-card"/g)||[]).length,1);
  c.invTotal=()=>10;c.invBalance=()=>0;c.modal=markup=>{c.modalHtml=markup;};c.window={print(){c.printCount=(c.printCount||0)+1;}};
  c.viewJob('JOB-BB26102301',0,true);
  assert.match(c.modalHtml,/<img class="job-print-logo" src="uw-document-logo\.png"/);
  assert.match(c.modalHtml,/Print \/ Save PDF/);
  assert.equal(c.printCount,1,'The job-card print action should open the browser print dialog');
});
test('new quote saving and quote lifecycle paths create or refresh a job',()=>{
  const editor=fs.readFileSync(path.join(root,'public/js/document-editor.js'),'utf8');
  const quotes=fs.readFileSync(path.join(root,'public/js/quotes.js'),'utf8');
  const history=fs.readFileSync(path.join(root,'public/js/quote-history.js'),'utf8');
  assert.match(editor,/DB\.quotes\.unshift\(quote\);syncQuoteJob\(quote\)/);
  assert.match(quotes,/syncQuoteJob\(quote,id\)/);
  assert.match(quotes,/const job=syncQuoteJob\(q\)/);
  assert.match(history,/syncQuoteJob\(q\);save\(\)/);
});
test('saving a new quote automatically persists its production job',()=>{
  const fields={'f-no':'BB26102301','f-date':'2026-10-23','f-cust':'A Customer','f-contact':'A Contact','f-phone':'0770000000','f-billing-address':'Address','f-email':'a@example.test','f-expiry':'2026-11-22','f-prepared-by':'Operator','f-project':'Lounge suite','f-work-type':'Reupholster','f-colour':'Navy','f-introduction':'Recover two cushions.'};
  const db={quotes:[],invoices:[],jobs:[],meta:{fy:'2026'}},messages=[],c=vm.createContext({DB:db,window:{invoiceFormMode:'quote'},document:{getElementById:id=>({value:fields[id]||''})},today:()=> '2026-10-23',fa:id=>fields[id]||'',collectDocumentItems:()=>[{item:'Fabric',desc:'Harbour weave',qty:5,price:100}],validQuoteNo:()=>true,validQuoteExpiry:()=>true,registerDocumentItemPresets:()=>{},save:()=>true,closeModal:()=>{},toast:message=>messages.push(message),go:()=>{}});
  for(const file of ['quote-history','job-production','document-editor'])vm.runInContext(fs.readFileSync(path.join(root,'public/js',file+'.js'),'utf8'),c);
  c.saveInvoice();
  assert.equal(db.quotes.length,1);assert.equal(db.jobs.length,1);assert.equal(db.jobs[0].quoteId,db.quotes[0].id);assert.equal(db.jobs[0].stage,'Quoted');assert.equal(db.jobs[0].customer,'A Customer');assert.equal(db.jobs[0].intakeDate,'2026-10-23');assert.equal(messages[0],'Quote BB26102301 created');
});
test('converting a quote attaches the invoice to its existing job instead of creating a duplicate',()=>{
  const quote={id:'BB26102302',date:'2026-10-23',customer:'A Customer',projectReference:'Dining chairs',items:[{desc:'Repair chairs',qty:4,price:50}],status:'Sent'};
  const db={quotes:[quote],invoices:[],jobs:[],meta:{fy:'2026'}},c=load(db);vm.runInContext(fs.readFileSync(path.join(root,'public/js/quote-history.js'),'utf8'),c);c.acceptQuoteVersion=()=>{quote.status='Accepted';return true;};c.today=()=> '2026-10-23';c.nextInvoiceNo=()=> 'BB26102303';c.save=()=>true;c.toast=()=>{};c.go=()=>{};
  vm.runInContext(fs.readFileSync(path.join(root,'public/js/quotes.js'),'utf8'),c);
  c.convertQuote(quote.id);
  assert.equal(db.jobs.length,1);assert.equal(db.jobs[0].quoteId,quote.id);assert.equal(db.jobs[0].invoiceId,'BB26102303');assert.equal(db.invoices.length,1);assert.equal(quote.status,'Accepted');
});
test('failed quote conversion restores the quote and leaves no orphan invoice or job',()=>{
  const quote={id:'BB26102303',date:'2026-10-23',expiry:'2026-11-22',customer:'A Customer',items:[{desc:'Repair',qty:1,price:50}],status:'Sent'};
  const db={quotes:[quote],invoices:[],jobs:[],meta:{fy:'2026'}},messages=[],c=load(db);
  vm.runInContext(fs.readFileSync(path.join(root,'public/js/quote-history.js'),'utf8'),c);c.today=()=> '2026-10-23';c.nextInvoiceNo=()=> 'BB26102304';c.save=()=>false;c.toast=message=>messages.push(message);c.go=()=>{};
  vm.runInContext(fs.readFileSync(path.join(root,'public/js/quotes.js'),'utf8'),c);c.convertQuote(quote.id);
  assert.equal(db.quotes[0].status,'Sent');assert.equal(db.quotes[0].acceptedVersion,undefined);assert.equal(db.invoices.length,0);assert.equal(db.jobs.length,0);assert.equal(messages.length,0);
});
