// Read-only evaluation of the actual reporting helpers against a fixed ledger snapshot.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const [statePath,outputPath]=process.argv.slice(2);
if(!statePath||!outputPath)throw Error('Usage: node audit-financial-controls.js STATE OUTPUT.json');
const snapshot=JSON.parse(fs.readFileSync(statePath,'utf8')),DB=snapshot.data;
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
function section(start,end){const a=html.indexOf(start),b=html.indexOf(end,a);if(a<0||b<0)throw Error('Audit helper not found: '+start);return html.slice(a,b);}
const c=vm.createContext({DB,serverRevision:snapshot.revision,today:()=>new Date().toLocaleDateString('en-CA'),monthOf:d=>String(d||'').slice(0,7)});
vm.runInContext(section('function dateMatchesFinancialPeriod(','function fyData(')+section('const invTotal =','function toast(msg)')+section('function canonicalExpenseCategory(','function duplicateExpenseCount(')+section('function wageLedgerAmount(','function canonicalExpenseCategory(')+section('function fnbTransactionAmount(','function fnbAllocationRule(')+section('function fnbTransactionMerchant(','function crossReferenceFnbPurchase('),c);
vm.runInContext('globalThis.invTotal=invTotal;globalThis.invBalance=invBalance;',c);
c.fnbSourceTransactions=()=>{const seen=new Set();return DB.fnbStatements.flatMap(s=>(s.transactions||[]).map(t=>({...t,statementId:s.id}))).filter(t=>{if(seen.has(String(t.id)))return false;seen.add(String(t.id));return true;});};
vm.runInContext(section('function fnbExpenseMatches(','function fnbExpenseOverlapCount(')+section('function buildAiContext(){','function escapeHtml('),c);
const matches=c.fnbExpenseMatches(),expenses=c.uniqueExpenses(DB.expenses),invoices=c.uniqueInvoices();
const scans=new Map(DB.scannedDocuments.map(d=>[String(d.id),d]));
const unsafePostedScans=expenses.filter(e=>e.sourceType==='scan').filter(e=>{const s=scans.get(String(e.sourceId));return !s||s.reviewStatus!=='Approved'||s.includedInTotals!==true;});
const duplicateEvidence=new Map();
for(const i of invoices){
 if(!i.sourceWorkbook)continue;
 const key=[i.date,String(i.customer||'').trim().toLowerCase(),String(i.project||'').trim().toLowerCase(),c.invTotal(i),c.invoiceCollectedAmount(i)].join('|');
 if(!duplicateEvidence.has(key))duplicateEvidence.set(key,[]);duplicateEvidence.get(key).push(i.id);
}
const payroll=c.employeeWagesTotal(),expenseTotal=expenses.reduce((s,e)=>s+Number(e.amount||0),0),collected=invoices.reduce((s,i)=>s+c.invoiceCollectedAmount(i),0);
const result={revision:snapshot.revision,reporting:{invoiceCount:invoices.length,expenseCount:expenses.length,recordedExpenseTotal:expenseTotal,undatedPayrollEstimate:payroll,costsIncludingPayroll:expenseTotal+payroll,collected,incomeLessCosts:collected-expenseTotal-payroll,outstanding:invoices.reduce((s,i)=>s+Math.max(0,c.invBalance(i)),0)},aiTotals:c.buildAiContext().derived.totals,bankExpenseMatches:{count:matches.length,amount:matches.reduce((s,m)=>s+Number(m.expense.amount||0),0),creditMatches:matches.filter(m=>c.fnbTransactionAmount(m.transaction)>=0).length},existingScanExpensesWithoutApproval:unsafePostedScans.map(e=>({id:e.sourceId,date:e.date,amount:e.amount})),possibleCrossIdInvoiceDuplicates:[...duplicateEvidence.values()].filter(ids=>ids.length>1),notes:['Potential duplicate groups require source review; identical customer/date/project/amount is not sufficient to delete separate invoices.','Existing scan expenses were retained for review, not silently removed.','Invoice-date receipts and undated payroll estimates cannot certify cash-flow or accrued profit for a month.']};
fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,JSON.stringify(result,null,2));
console.log(JSON.stringify({reporting:result.reporting,bankExpenseMatches:result.bankExpenseMatches,existingScanExpensesWithoutApproval:unsafePostedScans.length,possibleCrossIdInvoiceDuplicates:result.possibleCrossIdInvoiceDuplicates.length},null,2));
