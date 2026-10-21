const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assistant=require('../public/js/assistant-core');
const money=n=>'R '+n.toFixed(2);
function fixture(){return {meta:{syncPending:false},invoices:[{id:'I1',date:'2026-10-01',customer:'Alice',items:[{qty:2,price:100}],paid:30,deposit:20,dueDate:'2026-10-10'}, {id:'I1',date:'2026-10-01',items:[{qty:100,price:100}]}, {id:'I2',date:'2025-09-01',customer:'Bob',items:[{qty:1,price:50}],paid:0}],expenses:[{id:'E1',date:'2026-10-02',vendor:'Acme',amount:25,category:'Consumables'},{id:'E2',date:'2025-09-02',amount:10,category:'Other'}],quotes:[{id:'Q1',date:'2026-10-01',customer:'Alice',status:'Draft',expiry:'2026-10-02',items:[{qty:1,price:''}]}],jobs:[{id:'J1',stage:'In production',invoiceId:'missing'},{id:'J1',stage:'Closed'}],payables:[{id:'P1',status:'Unreviewed',amount:0}],wages:[{monthly:100,advances:20,weeks:[{owed:0}]}],stock:[{quantity:0,reorderLevel:5,unit:'Price list'},{quantity:1,reorderLevel:2,unit:'m'},{quantity:null,reorderLevel:2}],scannedDocuments:[],fnbStatements:[{transactions:[{id:'B1',date:'2026-09-30',amount:-25,allocationNeedsReview:true}]}]};}
test('assistant matches unique ledger arithmetic and distinguishes unknown due dates and payroll estimates',()=>{
 const db=fixture(),before=JSON.stringify(db),r=assistant.analyze(db,{asOf:'2026-10-12'});
 assert.equal(r.summary.collected,50);assert.equal(r.summary.outstanding,200);assert.equal(r.summary.recordedExpenses,35);assert.equal(r.summary.payrollEstimate,80);assert.equal(r.summary.incomeLessCosts,-65);
 assert.equal(r.summary.overdueCount,1);assert.equal(r.summary.overdue,150);assert.equal(r.summary.missingDueCount,1);assert.equal(r.summary.openJobs,1);assert.equal(r.stock.length,1);
 assert.equal(JSON.stringify(db),before,'Analysis must not change any record');
});
test('currency totals round after aggregation instead of inflating sub-cent records',()=>{
 const db={invoices:[{id:'A',items:[{qty:1,price:.005}]},{id:'B',items:[{qty:1,price:.005}]}],expenses:[{id:'E1',date:'2026-10-01',vendor:'A',amount:.005,category:'Other'},{id:'E2',date:'2026-10-02',vendor:'B',amount:.005,category:'Other'}]};
 const r=assistant.analyze(db,{asOf:'2026-10-12'});assert.equal(r.summary.outstanding,.01);assert.equal(r.summary.recordedExpenses,.01);assert.equal(r.categories.Other,.01);
});
test('selected periods exclude other years, future YTD records and undated payroll without hiding global operational controls',()=>{
 const db=fixture();db.invoices.push({id:'FUTURE',date:'2026-12-01',items:[{qty:1,price:1000}],paid:1000});
 const r=assistant.analyze(db,{asOf:'2026-10-12',period:'ytd:2026'});
 assert.equal(r.summary.collected,50);assert.equal(r.summary.outstanding,150);assert.equal(r.summary.recordedExpenses,25);assert.equal(r.summary.incomeLessCosts,25);assert.equal(r.summary.payrollEstimate,80);
 assert.equal(r.controls.find(c=>c.key==='links').count,1);assert.equal(r.bankCoverage.end,'2026-09-30');assert.equal(r.expired.length,1);
 const year=assistant.analyze(db,{asOf:'2026-10-12',period:'year:2025'});assert.equal(year.summary.recordedExpenses,10);
});
test('incomplete amounts and unapproved scanned expenses stay explicit; the assistant never deletes duplicate candidates',()=>{
 const db=fixture();db.expenses.push({id:'S',date:'2026-10-03',amount:12,sourceType:'scan',sourceId:'scan'});db.scannedDocuments=[{id:'scan',canonical:true,reviewStatus:'AI reviewed',includedInTotals:false,aiReview:{successful:true}}];
 const r=assistant.analyze(db,{asOf:'2026-10-12'});assert.equal(r.controls.find(c=>c.key==='unapproved').count,1);assert.equal(r.quoteWarnings.length,1);assert.equal(r.controls.find(c=>c.key==='jobs').count,1);assert(r.provisional);
 const answer=assistant.answer(r,'Check bank evidence and duplicates',money);assert.match(answer.text,/not deleted/);assert.match(answer.text,/not a live bank balance/);
});
test('evidence retrieval is bounded, does not expose secrets or binaries and includes source uncertainty',()=>{
 const db=fixture();db.meta.apiKey='SECRET';db.meta.account='ACCOUNT-SECRET';db.invoices[0].data='BINARY-SECRET';db.invoices[0].email='PRIVATE-CONTACT';
 const r=assistant.analyze(db,{asOf:'2026-10-12',revision:7}),e=assistant.evidence(r,'Alice invoice');
 const serialized=JSON.stringify(e);assert(!/SECRET|PRIVATE-CONTACT/.test(serialized));assert.equal(e.revision,7);assert(e.relevantRecords.some(v=>v.id==='I1'));assert(e.coverage.detailListsAreLimited);
 assert.equal(assistant.validDate('2026-02-30'),false);
});
test('local answers cite evidence and disclose cash/profit limits and the 30% markup rule',()=>{
 const r=assistant.analyze(fixture(),{asOf:'2026-10-12',revision:3});
 assert.match(assistant.answer(r,'Who owes money?',money).text,/I1/);
 assert.match(assistant.answer(r,'Show profit and wages',money).text,/not verified accounting profit/);
 assert.match(assistant.answer(r,'Quote markup and fabric pricing',money).text,/R100 cost gives a R130/);
 const targeted=assistant.answer(r,'How much does Alice owe?',money);assert.match(targeted.text,/R 150.00 across 1/);
 assert.match(assistant.answer(r,'Explain satellite telemetry',money).text,/No matching UW record/);
 const fabric=assistant.answer(r,'Fabric QA-APOLLO price',money,[{id:'QA-FAB',code:'QA-APOLLO',desc:'Apollo',supplier:'Helm',sourceDate:'2024-06',prices:[{key:'cut',amount:351,unit:'m',vat:'excl'}]}]);
 assert.match(fabric.text,/R 351.00 \/ m/);assert.match(fabric.text,/VAT excl/);
});
test('Gemini failure falls back to retained local facts and an answer can be saved only as a working note',async()=>{
 const db=fixture(),fields={'assistant-question':{value:'Who owes money?'}};let renders=0,saves=0;
 const c=vm.createContext({DB:db,state:{mfilter:''},serverRevision:5,today:()=> '2026-10-12',UW_ASSISTANT:assistant,R:money,isLegacyBulkScan:()=>false,current:'assistant',window:{UW_OPERATOR:{name:'Brian'}},crypto:require('node:crypto'),AbortController,setTimeout,clearTimeout,document:{getElementById:id=>fields[id]||null},fetch:async()=>({ok:false,status:503,json:async()=>({error:'Gemini temporarily unavailable'})}),toast:()=>{},render:()=>renders++,save:()=>saves++});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/assistant.js'),'utf8'),c);
 vm.runInContext("assistantState.provider='gemini'",c);const original=JSON.stringify(db.invoices);
 await c.runAssistantQuestion();const result=vm.runInContext('assistantState.result',c);
 assert.match(result.provider,/Local analysis/);assert.match(result.text,/I1/);assert.equal(vm.runInContext('assistantState.running',c),false);
 c.saveAssistantNote();c.saveAssistantNote();assert.equal(db.aiNotes.length,1);assert.equal(db.aiNotes[0].status,'Working note');assert.equal(saves,1);assert.equal(JSON.stringify(db.invoices),original);assert(renders>0);
});
test('source suggestions update only after explicit approval and roll back when saving fails or the source/record is stale',async()=>{
 const script=fs.readFileSync(path.join(__dirname,'../public/js/assistant.js'),'utf8');
 const run=async({recordAmount=25,currentValue=25,value=40,verifyOk=true,saveResult=true}={})=>{
  const db=fixture();db.expenses[0].amount=recordAmount;let saves=0;
  const c=vm.createContext({DB:db,state:{mfilter:''},serverRevision:5,today:()=> '2026-10-12',UW_ASSISTANT:assistant,R:money,isLegacyBulkScan:()=>false,current:'assistant',window:{UW_OPERATOR:{name:'Brian'}},crypto:require('node:crypto'),AbortController,setTimeout,clearTimeout,document:{getElementById:()=>null},fetch:async()=>({ok:verifyOk,status:verifyOk?200:409,json:async()=>verifyOk?{valid:true}:{error:'Source changed after review.'}}),toast:()=>{},render:()=>{},save:()=>{saves++;return saveResult;}});
  vm.runInContext(script,c);
  vm.runInContext(`assistantState.sourceSearch.searchId='search-1';assistantState.sourceSearch.proposals=[{id:'proposal-1',collection:'expenses',recordId:'E1',field:'amount',value:${value},currentValuePresent:true,currentValue:${currentValue},sourceId:'source-1',status:'pending'}]`,c);
  await c.approveAssistantSourceUpdate('proposal-1');
  return {db,saves,status:vm.runInContext("assistantState.sourceSearch.proposals[0].status",c)};
 };
 const approved=await run();
 assert.equal(approved.db.expenses[0].amount,40);assert.equal(approved.saves,1);assert.equal(approved.status,'approved');
 const failedSave=await run({saveResult:false});
 assert.equal(failedSave.db.expenses[0].amount,25,'A failed local save must revert the in-memory field.');assert.equal(failedSave.saves,1);assert.equal(failedSave.status,'failed');
 const staleRecord=await run({recordAmount:30,currentValue:25});
 assert.equal(staleRecord.db.expenses[0].amount,30);assert.equal(staleRecord.saves,0);assert.equal(staleRecord.status,'stale');
 const staleSource=await run({verifyOk:false});
 assert.equal(staleSource.db.expenses[0].amount,25);assert.equal(staleSource.saves,0);assert.equal(staleSource.status,'stale');
});
test('source-review panel explains empty results and provides a preview of selected-reviewable scans',()=>{
 const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const c=vm.createContext({escapeHtml});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/assistant.js'),'utf8'),c);
 vm.runInContext("assistantState.sourceSearch.searchId='search-1';assistantState.sourceSearch.matches=[]",c);
 assert.match(c.assistantSourceSearchPanel(),/No supported source files matched this search/);
 vm.runInContext("assistantState.sourceSearch.matches=[{sourceId:'source-1',name:'Receipt-1.jpg',relativePath:'Receipts\\\\Receipt-1.jpg',modifiedAt:'2026-10-21T00:00:00.000Z',size:1024,excerpt:'',filenameOnly:true,canReview:true}]",c);
 const panel=c.assistantSourceSearchPanel();
 assert.match(panel,/source-preview\?searchId=search-1&amp;sourceId=source-1/);
 assert.match(panel,/target="_blank" rel="noopener">View original/);
 assert.match(panel,/Open scanned PDFs and images before approving their transcribed evidence/);
});
