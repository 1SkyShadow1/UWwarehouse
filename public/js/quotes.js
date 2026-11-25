/* ---------- QUOTES ---------- */
function quoteItemOptions(selected=''){
  const categories=['Fabric','Foam','Labour','Consumables','Delivery','Other'];
  if(selected&&!categories.includes(selected))categories.push(selected);
  return categories.map(value=>`<option value="${escapeHtml(value)}" ${value===selected?'selected':''}>${escapeHtml(value)}</option>`).join('');
}
function quoteItemLabel(value){
  if(!value)return '—';
  const all=[...(DB.fabrics||[]).map(x=>({value:x.code,label:x.desc})),...(DB.stock||[]).map(x=>({value:x.sku||x.name,label:x.name})),...(DB.priceBook||[]).map(x=>({value:x.code,label:x.desc}))];
  return all.find(x=>x.value===value)?.label||value;
}
function vQuotes(c){
  const rows=sortDocumentsByDate(DB.quotes.filter(q=>docMatches(q,'quotes','Quotation',q.status)),'quotes');
  c.innerHTML=`<div class="toolbar">${docFilterHtml('quotes',['Quotation'],['Draft','Sent','Accepted'])}<button class="btn gold" onclick="newQuote()">+ New Quote</button><button type="button" class="btn" id="quote-import-button" aria-describedby="quote-import-help" onclick="document.getElementById('quote-import-file').click()">Import Quote</button><input id="quote-import-file" type="file" accept=".xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden aria-label="Select a PDF quote or Excel quote workbook" onchange="importQuoteDocument(event)"><small id="quote-import-help">Searchable PDF or Excel .xlsx · current quote template</small></div><p id="quote-import-status" role="status" aria-live="polite" aria-atomic="true" hidden></p>
  <div class="panel"><p style="font-size:11px;color:var(--muted);margin-bottom:10px">${rows.length} quote document(s) match the current filters.</p>
  <table><tr><th>Quote No / revision</th><th>Date / validity</th><th>Customer</th><th>Work type</th><th>Colour</th><th class="num">Total</th><th>Status</th><th></th></tr>
  ${rows.map(q=>`<tr><td style="color:var(--gold2)">${escapeHtml(q.id)} · r${q.revision||1}${q.sourcePricingWarnings?.length?'<small style="display:block">Source pricing needs review</small>':''}${q.sourceDocumentId?`<small style="display:block">Imported from ${q.sourceDocumentType==='pdf'?'PDF':'Excel'}</small>`:''}</td><td>${escapeHtml(q.date||'')}<small style="display:block">${escapeHtml(quoteValidity(q))}${q.expiry?' · '+escapeHtml(q.expiry):''}</small></td><td>${escapeHtml(q.customer||'')}</td><td>${escapeHtml(q.workType||(q.sourceDocumentId?'—':'Reupholster'))}</td><td>${escapeHtml(q.colour||'—')}</td>
    <td class="num">${R(q.items.reduce((s,i)=>s+i.qty*i.price,0))}</td><td>${q.status==='Accepted'?'<span class="tag paid">Accepted</span>':'<span class="tag quote">'+escapeHtml(q.status||'Draft')+'</span>'}${q.sourceDocumentId&&q.reviewStatus==='Needs review'?'<small style="display:block">Needs review</small>':''}</td>
    <td style="white-space:nowrap"><button class="btn sm" onclick="viewQuote('${q.id}')">View</button>
    <button class="btn sm" onclick="editQuote('${q.id}')">Edit</button>
    <button class="btn sm" onclick="viewQuoteHistory('${q.id}')">Revisions</button>${q.status!=='Accepted'?`<button class="btn sm" onclick="acceptQuote('${q.id}')">Accept</button>`:''}<button class="btn sm" onclick="convertQuote('${q.id}')">→ Invoice</button><button class="btn sm whatsapp-btn" title="Share on WhatsApp" aria-label="Share quote on WhatsApp" onclick="shareDocumentWhatsApp('quote','${q.id}')">${whatsappIcon}</button>
    <button class="btn sm danger" onclick="del('quotes','${q.id}')">✕</button></td></tr>`).join('')}
  </table></div>`;
}
async function importQuoteDocument(event){
  const input=event.currentTarget,file=input.files?.[0],button=document.getElementById('quote-import-button'),status=document.getElementById('quote-import-status');
  if(!file)return;
  const showError=message=>{if(status){status.hidden=false;status.textContent=message;status.setAttribute('role','alert');}toast(message);};
  const isPdf=/\.pdf$/i.test(file.name),isWorkbook=/\.xlsx$/i.test(file.name);
  if(!isPdf&&!isWorkbook){showError('Choose a searchable PDF quote or an Excel .xlsx quote workbook.');input.value='';return;}
  const sourceLabel=isPdf?'PDF':'workbook';
  if(!serverSyncAvailable||serverRevision===null){showError('The shared workspace is not ready. Wait for it to connect, then retry the import.');input.value='';return;}
  button.disabled=true;input.disabled=true;
  if(status){status.hidden=false;status.textContent='Checking the shared workspace before import…';status.setAttribute('role','status');}
  try{
    if(serverSyncPending||DB.meta?.syncPending){
      await syncServerState(true,true);
      if(serverSyncPending||DB.meta?.syncPending)throw new Error('Save pending workspace changes before importing a quote.');
    }
    const body=new FormData();body.append('file',file);body.append('revision',String(serverRevision));
    let response=await fetch('/api/quotes/import',{method:'POST',body,credentials:'include'});
    if([401,403].includes(response.status)&&await refreshAuthSession()){
      response=await fetch('/api/quotes/import',{method:'POST',body,credentials:'include'});
    }
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||`Quote import failed (HTTP ${response.status}).`);
    if(!payload.snapshot||!payload.quote?.id)throw new Error('The server did not confirm the quote import. Refresh the workspace before retrying.');
    applySharedSnapshot(payload.snapshot);
    const missingCustomer=!payload.quote.customer;
    toast(payload.documentExports?.errors?.length
      ? `Quote ${payload.quote.id} imported as Draft · Needs review, but its native PDF could not be saved.`
      : `Quote ${payload.quote.id} imported as Draft · Needs review. Open the source ${sourceLabel} and review before accepting.${missingCustomer?' Its customer account name is blank and must be completed.':''}`);
  }catch(error){showError(error.message||`The quote ${sourceLabel} could not be imported. Check it and try again.`);}
  finally{input.value='';input.disabled=false;button.disabled=false;}
}
function newQuote(){newInvoice('quote');document.querySelector('#modal-root h3').textContent='New Quote';}
function editQuote(id){
  const q=DB.quotes.find(x=>x.id===id);if(!q)return;
  const sourceReview=q.sourcePricingWarnings?.length?`<div class="panel"><p>${q.sourcePricingWarnings.map(escapeHtml).join('<br>')}</p><label><input type="checkbox" id="eq-source-reviewed"> I have checked these source prices and selected the required options.</label></div>`:'';
  const sourceDocumentLabel=q.sourceDocumentType==='pdf'?'PDF':'workbook';
  const importReview=q.sourceDocumentId&&q.reviewStatus==='Needs review'?`<div class="panel"><p>This imported quote is a draft. Check its customer details, line items and totals against the original ${sourceDocumentLabel} before accepting it.${q.customer?'':' The customer account name was blank in the source; enter it before marking this quote reviewed.'}</p><a class="btn sm" href="${escapeHtml(q.sourceDocumentUrl||'')}" target="_blank" rel="noopener">Open source ${sourceDocumentLabel}</a><p><label><input type="checkbox" id="eq-import-reviewed"> I have checked this quote against the source ${sourceDocumentLabel}.</label></p></div>`:'';
  modal(`${sourceReview}${importReview}${fabricColourOptions()}<h3>Edit Quote ${q.id} · r${q.revision||1}</h3>${q.status==='Accepted'?'<p>Saving changes creates a draft revision. The accepted version and any issued invoice are preserved.</p>':''}<div class="frm"><div class="fld"><label>Quote No</label><input id="eq-no" value="${q.id}"></div><div class="fld"><label>Date</label><input id="eq-date" type="date" value="${q.date}"></div><div class="fld"><label>Customer</label><input id="eq-cust" value="${escapeHtml(q.customer||'')}"></div><div class="fld"><label>Contact</label><input id="eq-contact" value="${escapeHtml(q.contact||'')}"></div><div class="fld"><label>Telephone</label><input id="eq-phone" value="${escapeHtml(q.phone||'')}"></div><div class="fld"><label>Email</label><input id="eq-email" value="${escapeHtml(q.email||'')}"></div><div class="fld"><label>Billing address</label><textarea id="eq-billing-address">${escapeHtml(q.billingAddress||'')}</textarea></div><div class="fld"><label>Prepared by</label><input id="eq-prepared-by" value="${escapeHtml(q.preparedBy||'')}"></div><div class="fld"><label>Expiry</label><input id="eq-expiry" type="date" value="${q.expiry||''}"></div><div class="fld"><label>Project Reference</label><input id="eq-project" value="${escapeHtml(q.projectReference||'')}"></div><div class="fld"><label>Work type</label><select id="eq-work-type">${['Manufacturing','Repair','Reupholster'].map(x=>`<option ${q.workType===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="fld"><label>Colour</label><input id="eq-colour" list="fabric-colours" value="${escapeHtml(q.colour||'')}" placeholder="e.g. Stone, Charcoal, Navy"></div><div class="fld"><label>Introduction, notes and specifications</label><textarea id="eq-introduction" rows="3">${escapeHtml(q.introduction||q.notes||'')}</textarea></div></div>${quotePresetPickerHtml('eq-items','eq','eq')}<div class="fld"><label>Line Items</label></div><table id="eq-items"><tr><th>Description</th><th>Supplier fabric / price basis</th><th>Item</th><th>Qty</th><th>Selling / unit · internal cost</th><th></th></tr></table><button class="btn sm" onclick="addEditQuoteRow()">+ Add line</button><div class="toolbar" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn gold" onclick="saveEditedQuote('${id}')">Save Changes</button></div>`);
  (q.items||[]).forEach(addEditQuoteRow);if(!(q.items||[]).length)addEditQuoteRow();
}
function addEditQuoteRow(item={}){appendDocumentItem('eq-items','eq',item);}
function saveEditedQuote(id){
  const quote=DB.quotes.find(x=>x.id===id);if(!quote)return;
  const items=collectDocumentItems('eq-items','eq',true);if(!items)return;
  const nextId=fa('eq-no').trim();
  const importReviewRequired=quote.sourceDocumentId&&quote.reviewStatus==='Needs review';
  if(importReviewRequired&&!document.getElementById('eq-import-reviewed')?.checked){toast('Check the original source document and confirm the imported quote details before saving it as reviewed.');return;}
  if(!nextId||!fa('eq-date')||!fa('eq-cust')||!items.length){toast('Complete quote number, date, customer and line items');return;}
  if((nextId!==id||validQuoteNo(id,quote.date))&&!validQuoteNo(nextId,fa('eq-date'))){toast('Quote number must use BB or SS + DDMMYY + daily sequence, for example SS07102601');return;}
  if(DB.quotes.some(other=>other!==quote&&other.id===nextId)){toast('This quote number already exists');return;}
  if(!validQuoteExpiry(fa('eq-date'),fa('eq-expiry'))){toast('Quote expiry must be on or after its date');return;}
  const quoteIndex=DB.quotes.indexOf(quote),previousQuote=JSON.parse(JSON.stringify(quote)),previousJobs=JSON.parse(JSON.stringify(DB.jobs||[])),previousInvoices=JSON.parse(JSON.stringify(DB.invoices||[])),previousPresets=DB.meta?.savedItemPresets;
  registerDocumentItemPresets(items);
  reviseQuote(quote,{...(document.getElementById('eq-source-reviewed')?.checked?{sourcePricingWarnings:[]}:{}),...(importReviewRequired?{reviewStatus:'Approved'}:{}),id:nextId,date:fa('eq-date'),customer:fa('eq-cust'),contact:fa('eq-contact'),phone:fa('eq-phone'),email:fa('eq-email'),billingAddress:fa('eq-billing-address'),expiry:fa('eq-expiry'),preparedBy:fa('eq-prepared-by'),projectReference:fa('eq-project'),workType:fa('eq-work-type'),colour:fa('eq-colour'),introduction:fa('eq-introduction'),notes:fa('eq-introduction'),items});
  syncQuoteJob(quote,id);
  if(nextId!==id)for(const invoice of DB.invoices||[])if(invoice.generatedFromQuote===id)invoice.generatedFromQuote=nextId;
  if(!save()){DB.quotes[quoteIndex]=previousQuote;DB.jobs=previousJobs;DB.invoices=previousInvoices;if(DB.meta){if(previousPresets===undefined)delete DB.meta.savedItemPresets;else DB.meta.savedItemPresets=previousPresets;}return;}
  closeModal();toast('Quote updated');render();
}
function convertQuote(id){
  const q=DB.quotes.find(x=>x.id===id);
  if(!q)return;
  if(DB.invoices.some(i=>i.generatedFromQuote===id||(q.invoiceId&&i.id===q.invoiceId))){toast('This quote already has an invoice; use Undo invoice first');return;}
  const quoteIndex=DB.quotes.indexOf(q),previousQuote=JSON.parse(JSON.stringify(q)),previousJobs=JSON.parse(JSON.stringify(DB.jobs||[])),previousInvoices=(DB.invoices||[]).slice();
  if(!acceptQuoteVersion(q))return;
  const job=syncQuoteJob(q);
  const invoiceId=nextInvoiceNo(today(),String(q.id).startsWith('SS')?'SS':'BB');
  DB.invoices.unshift({id:invoiceId,date:today(),customer:q.customer,contact:q.contact||'',phone:q.phone||'',billingAddress:q.billingAddress||'',email:q.email||'',project:q.projectReference||'Re-Upholstery',introduction:q.introduction||q.notes||'',items:JSON.parse(JSON.stringify(q.items)).map(i=>({code:'',...i})),deposit:0,paid:0,status:'Pending',fy:DB.meta.fy,reviewStatus:'Approved',includedInTotals:true,generatedFromQuote:id,quoteRevision:q.revision,acceptedQuoteSnapshot:quoteSnapshot(q)});
  q.status='Accepted';q.invoicedAt=new Date().toISOString();q.invoiceId=invoiceId;job.invoiceId=invoiceId;
  if(!save()){DB.quotes[quoteIndex]=previousQuote;DB.jobs=previousJobs;DB.invoices=previousInvoices;return;}
  toast('Quote '+id+' converted to invoice '+invoiceId);go('invoices');
}
function undoQuoteInvoice(invoiceId){
  const invoice=DB.invoices.find(i=>i.id===invoiceId),quote=invoice&&DB.quotes.find(q=>q.id===invoice.generatedFromQuote);
  if(!invoice||!quote)return;
  const paid=(invoice.paid||0)+(invoice.deposit||0),receipts=(DB.receipts||[]).filter(r=>r.invoiceId===invoiceId);
  if(paid>0||receipts.length){toast('Cannot undo an invoice with payments or receipts recorded');return;}
  const job=(DB.jobs||[]).find(item=>String(item.quoteId||'')===String(quote.id)&&String(item.invoiceId||'')===String(invoiceId));
  if(job&&(job.stage&&job.stage!=='Quoted'&&job.stage!=='Quote'||Number(job.productionElapsedMs||0)>0||job.productionStartedAt||(job.stageHistory||[]).some(entry=>entry.from!=='Quoted'&&entry.from!=='Quote'||entry.to!=='Quoted'&&entry.to!=='Quote'))){toast('Cannot undo an invoice after production has advanced');return;}
  if(!confirm('Undo this invoice and return the quote to Draft?'))return;
  const previousInvoices=DB.invoices,previousQuote={status:quote.status,invoiceId:quote.invoiceId,invoicedAt:quote.invoicedAt},linkedJobs=(DB.jobs||[]).filter(item=>String(item.quoteId||'')===String(quote.id)&&String(item.invoiceId||'')===String(invoiceId));
  DB.invoices=DB.invoices.filter(i=>i!==invoice);quote.status='Draft';delete quote.invoiceId;delete quote.invoicedAt;
  for(const job of linkedJobs)job.invoiceId='';
  if(!save()){DB.invoices=previousInvoices;quote.status=previousQuote.status;if(previousQuote.invoiceId===undefined)delete quote.invoiceId;else quote.invoiceId=previousQuote.invoiceId;if(previousQuote.invoicedAt===undefined)delete quote.invoicedAt;else quote.invoicedAt=previousQuote.invoicedAt;for(const job of linkedJobs)job.invoiceId=invoiceId;return;}
  toast('Invoice undone; quote returned to Draft');go('quotes');
}
