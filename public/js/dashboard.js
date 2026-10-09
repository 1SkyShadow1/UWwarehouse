function dailyActions(db,asOf=today()){
  const actions=[],add=(kind,id,title,detail,priority=2)=>actions.push({kind,id:String(id),title,detail,priority});
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&dateAfterDays(value,0)===value;
  for(const invoice of db.invoices||[]){
    if(['Cancelled','Void'].includes(invoice.status))continue;
    const balance=moneyRound((invoice.items||[]).reduce((sum,line)=>sum+Number(line.qty)*Number(line.price),0)-Number(invoice.paid||0)-Number(invoice.deposit||0));
    if(balance<=0.005)continue;
    if(validDate(invoice.dueDate)&&invoice.dueDate<asOf)add('invoice',invoice.id,'Overdue invoice',`${invoice.customer||''} · Balance ${R(balance)} · Due ${invoice.dueDate}`,0);
    else if(!validDate(invoice.dueDate))add('invoice',invoice.id,'Outstanding invoice — due date missing',`${invoice.customer||''} · Balance ${R(balance)}`,3);
  }
  for(const q of db.quotes||[]){
    if(['Accepted','Rejected','Cancelled'].includes(q.status)||!validDate(q.expiry))continue;
    if(q.expiry<=dateAfterDays(asOf,7))add('quote',q.id,q.expiry<asOf?'Expired quote':'Quote expires within 7 days',`${q.customer||''} · r${q.revision||1} · ${q.expiry}`,q.expiry<asOf?1:2);
  }
  for(const job of db.jobs||[])if(job.stage==='Deposit received'||/awaiting|waiting/i.test(job.materialStatus||'')){
    if(['Delivered','Closed'].includes(job.stage))continue;
    add('job',job.id,'Job awaiting materials',`${job.customer||''} · ${job.project||''} · ${job.stage}`);
  }
  for(const stock of db.stock||[])if(stockNeedsReorder(stock))add('stock',stock.sku||stock.name,'Low stock',`${stock.name} · ${stock.quantity} ${stock.unit||'units'} available · Reorder at ${stock.reorderLevel}`);
  for(const statement of db.fnbStatements||[])for(const [index,row] of (statement.transactions||[]).entries())if(!row.ledgerPosted&&(row.allocationNeedsReview||!row.category))add('bank',row.id||`${statement.id}-${index+1}`,'Bank allocation needs review',`${row.date||''} · ${row.description||''}`,2);
  for(const scan of db.scannedDocuments||[])if(scan.canonical&&!scan.existingMatch&&scan.reviewStatus!=='Approved'&&scan.fnbReview?.accountConfirmed===false)add('scan',scan.id,'Receipt bank match needs review',`${scan.name||''} · ${scan.fnbReview.status||'Unmatched'}`,2);
  const seen=new Set();return actions.filter(action=>{const key=action.kind+'|'+action.id;if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
}
function dailyActionsHtml(){
  const all=dailyActions(DB),filter=state.dailyActionFilter||'',actions=all.filter(a=>!filter||a.kind===filter);
  return `<div class="panel"><h3>Daily actions · ${today()} <span>${all.length} to review</span></h3><p style="color:var(--muted)">Live actions across all dates, independent of the financial month filter. Missing due dates are flagged without assuming an invoice is overdue.</p><select aria-label="Daily action category" onchange="state.dailyActionFilter=this.value;render()"><option value="">All actions</option>${[['invoice','Invoices'],['quote','Quotes'],['job','Jobs'],['stock','Stock'],['bank','Bank review'],['scan','Receipt matches']].map(([key,label])=>`<option value="${key}" ${filter===key?'selected':''}>${label} (${all.filter(a=>a.kind===key).length})</option>`).join('')}</select><div style="max-height:340px;overflow:auto"><table><tr><th>Action</th><th>Record</th><th>Details</th><th></th></tr>${actions.map(a=>`<tr><td>${escapeHtml(a.title)}</td><td>${escapeHtml(a.id)}</td><td style="white-space:normal">${escapeHtml(a.detail)}</td><td><button class="btn sm" onclick="openDailyAction('${a.kind}',${escapeHtml(JSON.stringify(a.id))})">Open</button></td></tr>`).join('')||'<tr><td colspan="4">No actions in this category.</td></tr>'}</table></div></div>`;
}
function openDailyAction(kind,id){
  if(kind==='scan'){const scan=(DB.scannedDocuments||[]).find(s=>String(s.id)===id);if(scan){go('scanned');viewDocument(scan);}return;}
  if(kind==='invoice'){go('invoices');viewInvoice(id);return;}
  if(kind==='quote'){go('quotes');editQuote(id);return;}
  if(kind==='job'){go('jobs');viewJob(id);return;}
  if(kind==='stock'){
    const stock=(DB.stock||[]).find(s=>String(s.sku||s.name)===id);if(!stock)return;
    go('suppliers');modal(`<h3>${escapeHtml(stock.name)}</h3><p>Supplier: ${escapeHtml(stock.supplier||'—')} · Quantity: ${stock.quantity} ${escapeHtml(stock.unit||'units')} · Reorder level: ${stock.reorderLevel}</p><button class="btn" onclick="closeModal()">Open stock register</button>`);return;
  }
  if(kind==='bank'){
    go('bank');const row=fnbSourceTransactions().find(row=>String(row.id)===id);
    if(!row)return;
    modal(`<h3>Bank allocation review</h3><p>${escapeHtml(id)} · ${escapeHtml(row.date||'')} · ${escapeHtml(row.description||'')}</p><p>Debit ${R(row.debit||0)} · Credit ${R(row.credit||0)} · ${escapeHtml(row.statementName||'')}</p><label>Allocation category<select aria-label="Bank action category" onchange="setFnbTransactionCategory(${escapeHtml(JSON.stringify(row.statementId))},${escapeHtml(JSON.stringify(row.id))},this.value);closeModal()"><option value="">Unallocated</option>${(window.UW_FNB_STATEMENTS?.categories||[]).map(category=>`<option ${row.category===category?'selected':''}>${escapeHtml(category)}</option>`).join('')}</select></label><p>Allocation does not post another expense.</p><button class="btn" onclick="closeModal()">Open bank register</button>`);
  }
}
function financialAuditWarningHtml(){
  const scans=new Map((DB.scannedDocuments||[]).map(scan=>[String(scan.id),scan]));
  const pendingPosted=uniqueExpenses(DB.expenses).filter(expense=>expense.sourceType==='scan').filter(expense=>{
    const scan=scans.get(String(expense.sourceId));return !scan||scan.reviewStatus!=='Approved'||scan.includedInTotals!==true;
  }).length;
  const unpriced=uniqueInvoices().filter(invoice=>!(invoice.items||[]).length||(invoice.items||[]).some(line=>line.price==null||Number(line.price)<=0)).length;
  const ids=new Set(uniqueInvoices().map(invoice=>String(invoice.id)));
  const brokenJobs=(DB.jobs||[]).filter(job=>job.invoiceId&&!ids.has(String(job.invoiceId))).length;
  if(!pendingPosted&&!unpriced&&!brokenJobs)return '';
  return `<p role="status" style="color:var(--amber)"><b>Financial totals remain provisional.</b> ${pendingPosted} previously posted scan expense(s) lack explicit approval; ${unpriced} invoice(s) have missing or zero line prices; ${brokenJobs} job(s) have unresolved invoice links. Existing records are retained for source reconciliation. New scan expenses require approval before posting.</p>`;
}
function vDashboard(c){
  const mf=state.mfilter;
  const inv=uniqueInvoices().filter(i=>dateMatchesFinancialPeriod(i.date,mf));
  const exp=uniqueExpenses(DB.expenses.filter(e=>dateMatchesFinancialPeriod(e.date,mf)));
  const fnbSummary=fnbReconciliationSummary(mf);
  const crossRef=crossReferenceSummary(mf);
  const fnbCats=fnbAllocatedCategoryTotals(mf);
  const fnbAllocatedTotal=fnbSummary.unposted;
  const fnbExpenseOverlaps=crossRef.fnbExpenseMatchCount;
  const fnbExpenseOverlapTotal=crossRef.fnbExpenseMatchAmount;
  const inc=inv.reduce((s,i)=>s+invoiceCollectedAmount(i),0);
  const wageT=mf?0:employeeWagesTotal();
  const expT=exp.reduce((s,e)=>s+e.amount,0)+wageT;
  const out=inv.filter(i=>invBalance(i)>0.005);
  const outT=out.reduce((s,i)=>s+invBalance(i),0);
  const qPend=uniqueQuotes().filter(q=>!['Accepted','Rejected','Cancelled'].includes(q.status)).length;
  const cats={};exp.forEach(e=>{const category=canonicalExpenseCategory(e.category);cats[category]=(cats[category]||0)+Number(e.amount||0);});
  if(wageT)cats['Employee wages / Salary']=(cats['Employee wages / Salary']||0)+wageT;
  const maxC=Math.max(1,...Object.values(cats));
  c.innerHTML=`
  ${dailyActionsHtml()}
  <div class="toolbar">${monthFilterHtml('mf')}</div>
  <div class="cards">
    <div class="card"><div class="lbl">Total Income (collected)</div><div class="val gold">${R(inc)}</div><div class="sub">${inv.length} unique invoice(s)${mf?' · '+mf:''} · paid + deposits</div></div>
    <div class="card"><div class="lbl">${mf?'Recorded expenses':'Recorded costs + payroll estimate'}</div><div class="val red">${R(expT)}</div><div class="sub">${exp.length} unique entries${mf?' · wages not date-scoped':''}${!mf?' + undated payroll obligation':''}</div></div>
    <div class="card"><div class="lbl">FNB reconciled spend</div><div class="val amber">${R(fnbSummary.total)}</div><div class="sub">${R(fnbSummary.posted)} posted once · ${R(fnbAllocatedTotal)} still unposted</div></div>
    <div class="card"><div class="lbl">Receipt/card cross-reference</div><div class="val">${crossRef.matchedScanCount}</div><div class="sub">${R(crossRef.matchedScanAmount)} receipt evidence matched · ${crossRef.reviewedScanCount} reviewed</div></div>
    <div class="card"><div class="lbl">Income less recorded costs</div><div class="val ${inc-expT>=0?'green':'red'}">${R(inc-expT)}</div><div class="sub">${mf?'Invoice-date income − dated expenses':'Collected income − expenses − undated payroll estimate'}</div></div>
    <div class="card"><div class="lbl">Outstanding Invoices</div><div class="val" style="color:var(--amber)">${R(outT)}</div><div class="sub">${out.length} unpaid</div></div>
    <div class="card"><div class="lbl">Pending Quotes</div><div class="val">${qPend}</div><div class="sub">${uniqueQuotes().length} unique total quotes · ${DB.meta.importVersion?'historical data loaded locally':'local data'}</div></div>
    <div class="card"><div class="lbl">Scanned documents awaiting Gemini</div><div class="val">${(DB.scannedDocuments||[]).filter(d=>!isLegacyBulkScan(d)&&d.canonical&&!d.existingMatch&&!geminiReviewComplete(d)).length}</div><div class="sub">Failed and pending scans can be retried</div></div>
  </div>
  <div class="grid2">
    <div class="panel"><h3>Recorded expense ledger · categories ${mf?'· '+mf:''}</h3>
      ${Object.keys(cats).length?Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`
        <div class="bar-row"><span style="width:110px;color:var(--muted)">${k}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(v/maxC*100).toFixed(1)}%"></div></div>
        <b style="width:110px;text-align:right">${R(v)}</b></div>`).join(''):'<div class="empty">No expenses this period</div>'}
    </div>
    <div class="panel"><h3>Recent Invoices</h3>
      <table><tr><th>No</th><th>Customer</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th></tr>
      ${inv.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.id).localeCompare(String(a.id))).slice(0,6).map(i=>`<tr><td>${i.id}</td><td>${i.customer}</td><td class="num">${R(invTotal(i))}</td><td class="num">${R(invBalance(i))}</td><td>${statusBadge(i.status)}</td></tr>`).join('')}
      </table>
    </div>
  </div>
  <div class="panel"><h3>FNB source register · unposted bank debits ${mf?'· '+mf:''}</h3>
    <p style="font-size:11px;color:var(--muted)">This is a bank-source reconciliation view, not a second expense ledger. FNB spend is shown once in the reconciled total; posted rows are already represented in Total Expenses and only unposted rows remain in the category breakdown below.</p>
    ${Object.keys(fnbCats).length?Object.entries(fnbCats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="bar-row"><span style="width:190px;color:var(--muted)">FNB · ${k} <small>(unposted)</small></span><div class="bar-track"><div class="bar-fill" style="width:${(v/Math.max(1,...Object.values(fnbCats))*100).toFixed(1)}%"></div></div><b style="width:110px;text-align:right">${R(v)}</b></div>`).join(''):'<div class="empty">No unposted FNB debits for this period</div>'}
  </div>
  <div class="panel"><h3>Financial data controls</h3>
    ${financialAuditWarningHtml()}
    <p style="font-size:11px;color:var(--muted)">Employee wages / Salary is the only wage section and includes both unique recorded salary payments and the payroll ledger obligation; neither source is discarded. The expense category panel contains recorded operational expenses only. The FNB reconciled total contains eligible bank debits exactly once: ${R(fnbSummary.posted)} are posted into the ledger and ${R(fnbSummary.unposted)} remain unposted source evidence. ${fnbExpenseOverlaps?`${fnbExpenseOverlaps} FNB debit(s), totaling ${R(fnbExpenseOverlapTotal)}, match recorded expenses by debit amount, date and available merchant evidence; they are not added again.`:'No FNB debit currently matches a recorded expense by debit amount, date and available merchant evidence.'} Receipt cross-reference: ${crossRef.matchedScanCount} reviewed receipt(s) match card debits for ${R(crossRef.matchedScanAmount)}; ${crossRef.reviewedScanCount-crossRef.matchedScanCount} reviewed receipt(s) remain unmatched for review. New scan expenses require explicit approval before posting; retained historical scan expenses without approval remain flagged for review. Month-filtered totals exclude undated aggregate payroll rather than assigning it to the wrong month.</p>
  </div>
  <div class="panel"><h3>Quick Actions</h3>
    <div class="toolbar">
      <button class="btn gold" onclick="go('invoices');setTimeout(newInvoice,100)">+ New Invoice</button>
      <button class="btn gold" onclick="go('quotes');setTimeout(newQuote,100)">+ New Quote</button>
      <button class="btn" onclick="go('receipts');setTimeout(newReceipt,100)">+ Log Receipt</button>
      <button class="btn" onclick="go('expenses');setTimeout(newExpense,100)">+ Add Expense</button>
      <button class="btn" onclick="go('pricing')">Open Pricing Calculator</button>
    </div>
  </div>`;
}
