/* ---------- QUOTES ---------- */
function quoteItemOptions(selected=''){
  const groups={Materials:[],Labour:[],Consumables:[]};
  const add=(group,value,label)=>{if(value&&!groups[group].some(x=>x.value===value))groups[group].push({value,label});};
  const categories=[
    ['Fabric','Fabric'],
    ['Foam','Foam'],
    ['Labour','Labour'],
    ['Consumables','Consumables'],
    ['Delivery','Delivery'],
    ['Other','Other'],
  ];
  (DB.stock||[]).forEach(s=>{
    const name=String(s.name||'').trim();if(name)add('Materials',s.sku||name,`${name}${s.supplier?' — '+s.supplier:''}`);
  });
  (DB.priceBook||[]).forEach(p=>add('Materials',p.code||p.desc,p.desc||p.code));
  (DB.payables||[]).filter(p=>/material|fabric|foam|consum/i.test(`${p.category||''} ${p.description||''} ${p.vendor||''}`))
    .forEach(p=>add(/consum/i.test(p.category||'')?'Consumables':'Materials',p.description||p.vendor,`${p.description||p.vendor}${p.vendor?' — '+p.vendor:''}`));
  ['Upholstery labour','Removal and preparation labour','Cutting and sewing labour','Installation labour'].forEach(x=>add('Labour',x,x));
  ['Foam','High-density foam','Webbing','Springs','Batting / Dacron','Staples','Adhesive / glue','Thread','Zips','Calico / lining','Dust cover fabric','Screws and fasteners','Packaging and delivery consumables'].forEach(x=>add('Consumables',x,x));
  if(selected&&!categories.some(([value])=>value===selected)&&!Object.values(groups).some(items=>items.some(x=>x.value===selected)))add('Materials',selected,quoteItemLabel(selected));
  return `<optgroup label="Cost category">${categories.map(([value,label])=>`<option value="${escapeHtml(value)}" ${value===selected?'selected':''}>${escapeHtml(label)}</option>`).join('')}</optgroup>${Object.entries(groups).map(([group,items])=>`<optgroup label="${group}">${items.map(x=>`<option value="${escapeHtml(x.value)}" ${x.value===selected?'selected':''}>${escapeHtml(x.label)}</option>`).join('')}</optgroup>`).join('')}`;
}
function quoteItemLabel(value){
  if(!value)return '—';
  const all=[...(DB.fabrics||[]).map(x=>({value:x.code,label:x.desc})),...(DB.stock||[]).map(x=>({value:x.sku||x.name,label:x.name})),...(DB.priceBook||[]).map(x=>({value:x.code,label:x.desc}))];
  return all.find(x=>x.value===value)?.label||value;
}
function vQuotes(c){
  const rows=sortDocumentsByDate(DB.quotes.filter(q=>docMatches(q,'quotes','Quotation',q.status)),'quotes');
  c.innerHTML=`<div class="toolbar">${docFilterHtml('quotes',['Quotation'],['Draft','Sent','Accepted'])}<button class="btn gold" onclick="newQuote()">+ New Quote</button></div>
  <div class="panel"><p style="font-size:11px;color:var(--muted);margin-bottom:10px">${rows.length} quote document(s) match the current filters.</p>
  <table><tr><th>Quote No / revision</th><th>Date / validity</th><th>Customer</th><th>Work type</th><th>Colour</th><th class="num">Total</th><th>Status</th><th></th></tr>
  ${rows.map(q=>`<tr><td style="color:var(--gold2)">${q.id} · r${q.revision||1}</td><td>${q.date}<small style="display:block">${escapeHtml(quoteValidity(q))}${q.expiry?' · '+escapeHtml(q.expiry):''}</small></td><td>${q.customer}</td><td>${q.workType||'Reupholster'}</td><td>${q.colour||'—'}</td>
    <td class="num">${R(q.items.reduce((s,i)=>s+i.qty*i.price,0))}</td><td>${q.status==='Accepted'?'<span class="tag paid">Accepted</span>':'<span class="tag quote">'+q.status+'</span>'}</td>
    <td style="white-space:nowrap"><button class="btn sm" onclick="viewQuote('${q.id}')">View</button>
    <button class="btn sm" onclick="editQuote('${q.id}')">Edit</button>
    <button class="btn sm" onclick="viewQuoteHistory('${q.id}')">Revisions</button>${q.status!=='Accepted'?`<button class="btn sm" onclick="acceptQuote('${q.id}')">Accept</button>`:''}<button class="btn sm" onclick="convertQuote('${q.id}')">→ Invoice</button><button class="btn sm whatsapp-btn" title="Share on WhatsApp" aria-label="Share quote on WhatsApp" onclick="shareDocumentWhatsApp('quote','${q.id}')">${whatsappIcon}</button>
    <button class="btn sm danger" onclick="del('quotes','${q.id}')">✕</button></td></tr>`).join('')}
  </table></div>`;
}
function newQuote(){newInvoice('quote');document.querySelector('#modal-root h3').textContent='New Quote';}
function editQuote(id){
  const q=DB.quotes.find(x=>x.id===id);if(!q)return;
  modal(`<h3>Edit Quote ${q.id} · r${q.revision||1}</h3>${q.status==='Accepted'?'<p>Saving changes creates a draft revision. The accepted version and any issued invoice are preserved.</p>':''}<div class="frm"><div class="fld"><label>Quote No</label><input id="eq-no" value="${q.id}"></div><div class="fld"><label>Date</label><input id="eq-date" type="date" value="${q.date}"></div><div class="fld"><label>Customer</label><input id="eq-cust" value="${q.customer||''}"></div><div class="fld"><label>Contact</label><input id="eq-contact" value="${q.contact||''}"></div><div class="fld"><label>Telephone</label><input id="eq-phone" value="${escapeHtml(q.phone||'')}"></div><div class="fld"><label>Email</label><input id="eq-email" value="${escapeHtml(q.email||'')}"></div><div class="fld"><label>Billing address</label><textarea id="eq-billing-address">${escapeHtml(q.billingAddress||'')}</textarea></div><div class="fld"><label>Prepared by</label><input id="eq-prepared-by" value="${escapeHtml(q.preparedBy||'')}"></div><div class="fld"><label>Expiry</label><input id="eq-expiry" type="date" value="${q.expiry||''}"></div><div class="fld"><label>Project Reference</label><input id="eq-project" value="${q.projectReference||''}"></div><div class="fld"><label>Work type</label><select id="eq-work-type">${['Manufacturing','Repair','Reupholster'].map(x=>`<option ${q.workType===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="fld"><label>Colour</label><input id="eq-colour" value="${q.colour||''}" placeholder="e.g. Stone, Charcoal, Navy"></div><div class="fld"><label>Introduction, notes and specifications</label><textarea id="eq-introduction" rows="3">${q.introduction||q.notes||''}</textarea></div></div><div class="fld"><label>Line Items</label></div><table id="eq-items"><tr><th>Description</th><th>Supplier fabric / price basis</th><th>Item</th><th>Qty</th><th>Selling / unit · internal cost</th><th></th></tr></table><button class="btn sm" onclick="addEditQuoteRow()">+ Add line</button><div class="toolbar" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn gold" onclick="saveEditedQuote('${id}')">Save Changes</button></div>`);
  (q.items||[]).forEach(addEditQuoteRow);if(!(q.items||[]).length)addEditQuoteRow();
}
function addEditQuoteRow(item={}){appendDocumentItem('eq-items','eq',item,true,false);}
function saveEditedQuote(id){
  const quote=DB.quotes.find(x=>x.id===id);if(!quote)return;
  const items=collectDocumentItems('eq-items','eq');if(!items)return;
  const nextId=fa('eq-no').trim();
  if(!nextId||!fa('eq-date')||!fa('eq-cust')||!items.length){toast('Complete quote number, date, customer and line items');return;}
  if(DB.quotes.some(other=>other!==quote&&other.id===nextId)){toast('This quote number already exists');return;}
  if(!validQuoteExpiry(fa('eq-date'),fa('eq-expiry'))){toast('Quote expiry must be on or after its date');return;}
  reviseQuote(quote,{id:nextId,date:fa('eq-date'),customer:fa('eq-cust'),contact:fa('eq-contact'),phone:fa('eq-phone'),email:fa('eq-email'),billingAddress:fa('eq-billing-address'),expiry:fa('eq-expiry'),preparedBy:fa('eq-prepared-by'),projectReference:fa('eq-project'),workType:fa('eq-work-type'),colour:fa('eq-colour'),introduction:fa('eq-introduction'),notes:fa('eq-introduction'),items});
  if(nextId!==id)for(const invoice of DB.invoices||[])if(invoice.generatedFromQuote===id)invoice.generatedFromQuote=nextId;
  save();closeModal();toast('Quote updated');render();
}
function convertQuote(id){
  const q=DB.quotes.find(x=>x.id===id);
  if(!q)return;
  if(DB.invoices.some(i=>i.generatedFromQuote===id||i.id===id)){toast('This quote already has an invoice; use Undo invoice first');return;}
  if(!acceptQuoteVersion(q))return;
  const invoiceId=nextInvoiceNo(today(),'BB');
  DB.invoices.unshift({id:invoiceId,date:today(),customer:q.customer,contact:q.contact||'',phone:q.phone||'',billingAddress:q.billingAddress||'',email:q.email||'',project:q.projectReference||'Re-Upholstery',introduction:q.introduction||q.notes||'',items:JSON.parse(JSON.stringify(q.items)).map(i=>({code:'',...i})),deposit:0,paid:0,status:'Pending',fy:DB.meta.fy,reviewStatus:'Approved',includedInTotals:true,generatedFromQuote:id,quoteRevision:q.revision,acceptedQuoteSnapshot:quoteSnapshot(q)});
  q.status='Accepted';q.invoicedAt=new Date().toISOString();q.invoiceId=invoiceId;save();toast('Quote '+id+' converted to invoice '+invoiceId);go('invoices');
}
function undoQuoteInvoice(invoiceId){
  const invoice=DB.invoices.find(i=>i.id===invoiceId),quote=invoice&&DB.quotes.find(q=>q.id===invoice.generatedFromQuote);
  if(!invoice||!quote)return;
  const paid=(invoice.paid||0)+(invoice.deposit||0),receipts=(DB.receipts||[]).filter(r=>r.invoiceId===invoiceId);
  if(paid>0||receipts.length){toast('Cannot undo an invoice with payments or receipts recorded');return;}
  if(!confirm('Undo this invoice and return the quote to Draft?'))return;
  DB.invoices=DB.invoices.filter(i=>i!==invoice);quote.status='Draft';delete quote.invoiceId;delete quote.invoicedAt;save();toast('Invoice undone; quote returned to Draft');go('quotes');
}
