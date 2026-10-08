const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
function section(start,end){return html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));}
function context(db){const c=vm.createContext({DB:db,serverRevision:7,monthOf:d=>String(d).slice(0,7),uniqueExpenses:e=>e,fnbSourceTransactions:()=>db.transactions||[],fnbTransactionAmount:t=>t.amount});vm.runInContext(section('const invTotal =','function toast(msg)')+section('function fnbTransactionMerchant(','function crossReferenceFnbPurchase('),c);return c;}
test('AI financial totals agree with unique invoice reporting and include deposits',()=>{
 const invoice={id:'BB26100801',items:[{qty:2,price:100}],paid:30,deposit:20};
 const c=context({invoices:[invoice,{...invoice}],expenses:[{amount:12}],receipts:[]});
 vm.runInContext(section('function buildAiContext(){','function escapeHtml('),c);
 const result=c.buildAiContext().derived;assert.equal(result.totals.invoiceCount,1);assert.equal(result.totals.income,50);assert.equal(result.totals.outstanding,150);assert.equal(result.totals.expenses,12);assert.equal(result.invoiceBalances.length,1);assert.equal(result.invoiceBalances[0].deposit,20);
});
test('expense reconciliation rejects bank credits, wrong merchants and wrong linked transactions',()=>{
 const db={expenses:[{date:'2026-10-08',amount:100,vendor:'Acme Textiles'}],transactions:[{id:'credit',date:'2026-10-08',amount:100,description:'Acme Textiles'},{id:'wrong',date:'2026-10-08',amount:-100,description:'Different Supplier'},{id:'debit',date:'2026-10-08',amount:-100,description:'POS Acme Textiles'}]};
 const c=context(db);vm.runInContext(section('function fnbExpenseMatches(','function fnbExpenseOverlapCount('),c);
 assert.equal(c.fnbExpenseMatches()[0].transaction.id,'debit');
 db.expenses[0].sourceType='fnb';db.expenses[0].sourceId='missing';assert.equal(c.fnbExpenseMatches().length,0);
 db.expenses[0].sourceId='debit';assert.equal(c.fnbExpenseMatches().length,1);
});
test('live quote job details work and missing jobs fail without crashing',()=>{
 const db={invoices:[],quotes:[{id:'Q',customer:'Customer',projectReference:'Chair'}],jobs:[]};let output='',message='';
 const c=context(db);c.modal=s=>output=s;c.toast=s=>message=s;c.escapeHtml=String;
 vm.runInContext(section('function viewJob(','function vPayables('),c);c.viewJob('Q');assert.match(output,/Chair/);c.viewJob('missing');assert.match(message,/no longer available/);
});
test('unapproved Gemini receipt evidence cannot automatically enter the expense ledger',()=>{
 const document={id:'scan',canonical:true,reviewStatus:'Needs review',includedInTotals:false,aiReview:{amountPaid:42,documentDate:'2026-10-08',confidence:.99,merchant:'Acme'}};
 const db={expenses:[],scannedDocuments:[document],meta:{}};
 const c=context(db);Object.assign(c,{isLegacyBulkScan:()=>false,geminiReviewComplete:()=>true,extractedDocumentAmount:d=>d.aiReview.amountPaid,extractedDocumentDate:d=>d.aiReview.documentDate,scanFnbMatch:()=>null,canonicalExpenseCategory:x=>x,canonicalFnbCategory:x=>x,markFnbLedgerPosted:()=>{},fnbExpenseMatches:()=>[]});
 vm.runInContext(section('function syncExpenseEvidence(','function documentRegisterExpenseEvidence('),c);
 assert.equal(c.syncExpenseEvidence(db),0);assert.equal(db.expenses.length,0);
 document.reviewStatus='Approved';document.includedInTotals=true;assert.equal(c.syncExpenseEvidence(db),1);assert.equal(db.expenses[0].amount,42);assert.equal(c.syncExpenseEvidence(db),0);
});
test('dashboard identifies retained source exceptions instead of certifying incomplete totals',()=>{
 const db={invoices:[{id:'I',items:[{qty:1,price:0}]}],expenses:[{sourceType:'scan',sourceId:'s',amount:12}],scannedDocuments:[{id:'s',reviewStatus:'AI reviewed',includedInTotals:false}],jobs:[{invoiceId:'missing'}]};
 const c=context(db),source=fs.readFileSync(path.join(__dirname,'../public/js/dashboard.js'),'utf8');
 vm.runInContext(source.slice(source.indexOf('function financialAuditWarningHtml('),source.indexOf('function vDashboard(')),c);
 assert.match(c.financialAuditWarningHtml(),/totals remain provisional/);assert.match(c.financialAuditWarningHtml(),/1 previously posted/);assert.match(c.financialAuditWarningHtml(),/1 job/);
});
test('ambiguous imported job IDs cannot edit the first matching job silently',()=>{
 const db={jobs:[{id:'BB',stage:'Closed'},{id:'BB',stage:'Quoted'}],invoices:[],quotes:[]};let saves=0;
 const c=context(db);Object.assign(c,{toast:()=>{},render:()=>{},save:()=>saves++});
 vm.runInContext(section('function updateJobStage(','function newJob('),c);
 c.updateJobStage('BB','Delivered');c.linkJobInvoice('BB','I');assert.equal(saves,0);assert.equal(db.jobs[0].stage,'Closed');assert.equal(db.jobs[1].stage,'Quoted');
});
