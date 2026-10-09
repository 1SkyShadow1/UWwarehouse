const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
test('financial periods include year and January to date without future or undated entries',()=>{
 const c=vm.createContext({today:()=> '2026-10-09'});
 vm.runInContext(section('function dateMatchesFinancialPeriod(','function fyData('),c);
 const matches=c.dateMatchesFinancialPeriod;
 assert.equal(matches('2026-01-01','ytd:2026'),true);
 assert.equal(matches('2026-10-09','ytd:2026'),true);
 assert.equal(matches('2026-10-10','ytd:2026'),false);
 assert.equal(matches('2025-12-31','ytd:2026'),false);
 assert.equal(matches('','year:2026'),false);
 assert.equal(matches('2026-02-30','year:2026'),false);
 assert.equal(matches('2026-12-31','year:2026'),true);
 assert.equal(matches('2025-03-01','year:2025'),true);
 assert.equal(matches('2026-02-01','2026-01'),false);
 assert.equal(matches('2026-01-31','2026-01'),true);
 assert.equal(matches('',''),true);
});
function section(start,end){return html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));}
function context(db){const c=vm.createContext({DB:db,serverRevision:7,today:()=> '2026-10-09',monthOf:d=>String(d).slice(0,7),uniqueExpenses:e=>e,fnbSourceTransactions:()=>db.transactions||[],fnbTransactionAmount:t=>t.amount});vm.runInContext(section('function dateMatchesFinancialPeriod(','function fyData(')+section('const invTotal =','function toast(msg)')+section('function fnbTransactionMerchant(','function crossReferenceFnbPurchase('),c);return c;}
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
test('bank matching parses transactions once and skips merchant work for unrelated dates',()=>{
 const db={expenses:Array.from({length:100},()=>({date:'2026-10-08',amount:100,vendor:'Acme'})),transactions:Array.from({length:250},(_,i)=>({id:String(i),date:'2025-01-01',amount:-100,description:'Acme'}))};
 const c=context(db);let amountCalls=0,merchantCalls=0;const tokens=c.fnbMerchantTokens;
 c.fnbTransactionAmount=t=>{amountCalls++;return t.amount;};c.fnbMerchantTokens=value=>{merchantCalls++;return tokens(value);};
 vm.runInContext(section('function fnbExpenseMatches(','function fnbExpenseOverlapCount('),c);
 assert.equal(c.fnbExpenseMatches().length,0);assert.equal(amountCalls,250);assert.equal(merchantCalls,100);
});
test('receipt cross-reference follows the financial month and matches each receipt once',()=>{
 const scans=[{date:'2026-09-01',amount:10,id:'S'},{date:'2026-10-01',amount:20,id:'O'}];let calls=0,expenseCalls=0;
 const c=context({invoices:[],expenses:[]});Object.assign(c,{scannedExpenseEvidence:()=>scans,geminiReviewComplete:()=>true,extractedDocumentDate:s=>s.date,extractedDocumentAmount:s=>s.amount,scanFnbMatch:s=>{calls++;return {transaction:{id:s.id}};},fnbReconciliationSummary:()=>({}),fnbExpenseMatches:()=>{expenseCalls++;return [];}});
 vm.runInContext(section('function crossReferenceSummary(','function syncExpenseEvidence('),c);
 const result=c.crossReferenceSummary('2026-10');assert.equal(result.reviewedScanCount,1);assert.equal(result.matchedScanAmount,20);assert.equal(calls,1);assert.equal(expenseCalls,1);
 const year=c.crossReferenceSummary('year:2026');assert.equal(year.reviewedScanCount,2);assert.equal(year.matchedScanAmount,30);
});
