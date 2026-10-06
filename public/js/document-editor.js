function newInvoice(mode='invoice'){
  window.invoiceFormMode=mode;
  const initialDate=today(), initialPrefix='BB';
  const prefixField=mode==='quote'?'':'<div class="fld"><label>Invoice initials</label><select id="f-prefix" onchange="document.getElementById(\'f-no\').value=nextInvoiceNo(document.getElementById(\'f-date\').value,this.value)"><option value="BB">BB</option><option value="EE">EE</option></select></div>';
  const dateHandler=mode==='quote'?'document.getElementById(\'f-no\').value=nextQuoteNo(this.value)':'document.getElementById(\'f-no\').value=nextInvoiceNo(this.value,document.getElementById(\'f-prefix\').value)';
  modal(`<h3>New Invoice</h3>
  <div class="frm">
    <div class="fld"><label>${mode==='quote'?'Quote No':'Invoice No'}</label><input id="f-no" value="${mode==='quote'?nextQuoteNo(initialDate):nextInvoiceNo(initialDate,initialPrefix)}" ${mode==='quote'?'readonly':''}></div>
    ${prefixField}
    <div class="fld"><label>Date</label><input id="f-date" type="date" value="${initialDate}" onchange="${dateHandler};if(document.getElementById('f-expiry'))document.getElementById('f-expiry').value=dateAfterDays(this.value)"></div>
    ${mode==='quote'?`<div class="fld"><label>Valid until</label><input id="f-expiry" type="date" value="${dateAfterDays(initialDate)}"></div>`:''}
    ${mode==='invoice'?'<div class="fld"><label>Payment due date (optional)</label><input id="f-due" type="date"></div>':''}
    <div class="fld"><label>Customer</label><input id="f-cust"></div>
    <div class="fld"><label>Contact name</label><input id="f-contact"></div><div class="fld"><label>Telephone</label><input id="f-phone"></div>
    <div class="fld"><label>Email</label><input id="f-email"></div><div class="fld"><label>Billing address</label><textarea id="f-billing-address" rows="2"></textarea></div>
    <div class="fld"><label>${mode==='quote'?'Project Reference':'Project'}</label><input id="f-project" value="${mode==='quote'?'':'Re-Upholstery'}"></div>
    ${mode==='quote'?`<div class="fld"><label>Quote item preset</label><select id="f-preset" onchange="applyQuotePreset(this.value, this)"><option value="">Choose size/type/material preset…</option>${(Array.isArray(DB.priceBook)?DB.priceBook:[]).map((p,i)=>`<option value="${i}">${p.code||'Preset '+(i+1)} — ${p.desc||'Priced item'}</option>`).join('')}</select></div>
    <div class="fld"><label>Number of items</label><input id="f-qty" type="number" min="1" step="1" value="1" onchange="refreshQuotePreset()"></div>
    <div class="fld"><label>Work type</label><select id="f-work-type" onchange="refreshQuotePreset()"><option>Manufacturing</option><option>Repair</option><option>Reupholster</option></select></div>
    <div class="fld"><label>Material length</label><select id="f-length" onchange="refreshQuotePreset()"><option value="">Use preset length</option>${[1,2,3,4,5,6,7,8,9,10,11,12,14,16,18,20,22,24,26,30].map(length=>`<option value="${length}">${length}m</option>`).join('')}</select></div>
    <div class="fld"><label>Colour</label><select id="f-colour" onchange="refreshQuotePreset()"><option value="">Choose colour…</option>${['Sterling','Dessert','Stone','Charcoal','Navy','Black','Grey','Beige','Brown','Cream','Custom'].map(color=>`<option>${color}</option>`).join('')}</select></div>`:''}
  </div>
  ${mode==='quote'?'<div class="fld" style="margin-bottom:8px"><label>Introduction, notes and specifications</label><textarea id="f-introduction" rows="3"></textarea></div>':''}
  <div class="fld" style="margin-bottom:8px"><label>Line Items</label></div>
  <table id="f-items"><tr><th>Code</th><th>Description</th><th>Supplier fabric / price basis</th>${mode==='quote'?'<th>Item</th>':''}<th>Qty</th><th class="num">Selling / unit · internal cost</th><th></th></tr></table>
  <button class="btn sm" onclick="addItemRow()">+ Add line</button>
  <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
    <button class="btn" onclick="closeModal()">Cancel</button>
    <button class="btn gold" onclick="saveInvoice()">Save ${mode==='quote'?'Quote':'Invoice'}</button>
  </div>`);
  addItemRow();
}
function refreshQuotePreset(){
  const preset=document.getElementById('f-preset')?.value;
  if(preset!=='')applyQuotePreset(preset);
}
function applyQuotePreset(index,select){
  const presets=Array.isArray(DB.priceBook)?DB.priceBook:[];
  const presetIndex=Number.parseInt(index,10);
  if(!Number.isInteger(presetIndex)||presetIndex<0||presetIndex>=presets.length)return;
  const preset=presets[presetIndex];
  const quantity=Math.max(1,Number(document.getElementById('f-qty')?.value)||1);
  const workType=document.getElementById('f-work-type')?.value||'Reupholster';
  const selectedLength=Number(document.getElementById('f-length')?.value)||Number(preset.mtr)||1;
  const colour=document.getElementById('f-colour')?.value.trim()||'the selected colour';
  const introduction=document.getElementById('f-introduction');
  if(introduction) introduction.value=`${quantity} x ${preset.desc||'Item'} to be ${workType.toLowerCase()} in ${selectedLength}m ${colour} fabric.\n* New foam, decron, arm repair and consumables included.`;
  const table=document.getElementById('f-items');
  if(table){
    const selectedFabric=[...table.querySelectorAll('tr')].find(row=>row._lineItem?.fabricId);
    const savedFabric=selectedFabric?{...selectedFabric._lineItem,unitCost:selectedFabric.querySelector('.line-cost').value===''?null:Number(selectedFabric.querySelector('.line-cost').value),markupPercent:Number(selectedFabric.querySelector('.line-markup').value),pricingMode:selectedFabric.querySelector('.line-pricing-mode').value,code:selectedFabric.querySelector('.i-code')?.value||'',desc:selectedFabric.querySelector('.i-desc').value,price:selectedFabric.querySelector('.i-price').value===''?'':Number(selectedFabric.querySelector('.i-price').value)}:null;
    table.querySelectorAll('tr:not(:first-child)').forEach(row=>row.remove());
    quotePresetLines(preset,quantity,selectedLength,colour).forEach(line=>addItemRow(line.item==='Fabric'&&savedFabric?{...line,...savedFabric,qty:line.qty}:{...line,code:String(preset.code||'')}));
  }
  if(select)select.blur();
}
function quotePresetLines(preset,quantity=1,lengthOverride=null,colour=''){
  const name=String(preset?.desc||'Item');
  const count=Math.max(1,Number(quantity)||1);
  const length=Number(lengthOverride)||Number(preset?.mtr)||1;
  const colourLabel=colour?` (${length}m ${colour})`:` (${length}m)`;
  return [
    {item:'Fabric',desc:`${name} - Fabric${colourLabel}`,qty:length*count,price:Number(preset?.fabCost)||0},
    {item:'Foam',desc:`${name} - Foam / Decron / Comfortel`,qty:count,price:Number(preset?.matCost)||0},
    {item:'Labour',desc:`${name} - Labour`,qty:count,price:(Number(preset?.labHr)||0)*400},
    {item:'Consumables',desc:`${name} - Consumables`,qty:count,price:20},
  ].map(line=>({...line,unitCost:line.price,markupPercent:0,pricingMode:'markup'}));
}
function addItemRow(item={}){appendDocumentItem('f-items','i',item,window.invoiceFormMode==='quote');}
function saveInvoice(){
  const items=collectDocumentItems('f-items','i');if(!items)return;
  const common={id:document.getElementById('f-no').value,date:document.getElementById('f-date').value,customer:document.getElementById('f-cust').value,contact:document.getElementById('f-contact').value,phone:document.getElementById('f-phone').value,billingAddress:document.getElementById('f-billing-address').value,email:document.getElementById('f-email').value,items};
  if(!common.id||!common.date||!common.customer||!items.length){toast('Enter invoice number, date, customer and at least one line item');return;}
  const collection=window.invoiceFormMode==='quote'?DB.quotes:DB.invoices;
  if(collection.some(doc=>doc.id===common.id)){toast('This document number already exists');return;}
  if(window.invoiceFormMode==='quote'){
    const expiry=fa('f-expiry');if(!validQuoteExpiry(common.date,expiry)){toast('Quote expiry must be on or after its date');return;}
    DB.quotes.unshift(initializeQuoteHistory({...common,expiry,projectReference:document.getElementById('f-project').value,workType:document.getElementById('f-work-type')?.value||'Reupholster',colour:document.getElementById('f-colour')?.value||'',introduction:document.getElementById('f-introduction')?.value||'',notes:document.getElementById('f-introduction')?.value||'',status:'Draft',terms:true,reviewStatus:'Approved',includedInTotals:false}));
    save();closeModal();toast('Quote '+common.id+' created');go('quotes');
  }else{
    if(!validInvoiceNo(common.id,common.date)){toast('Invoice number must use BB or EE + YYYY/MM/DD + two-digit sequence, for example BB2026/09/0901');return;}
    const inv={...common,dueDate:fa('f-due'),project:document.getElementById('f-project').value,deposit:0,paid:0,status:'Pending',fy:DB.meta.fy};
    DB.invoices.unshift(inv);save();closeModal();toast('Invoice '+inv.id+' created');render();
  }
}
function editInvoice(id){
    const i=DB.invoices.find(x=>x.id===id); if(!i)return;
    modal(`<h3>Edit Invoice ${i.id}</h3><div class="frm">
      <div class="fld"><label>Invoice No</label><input id="ef-no" value="${i.id}"></div><div class="fld"><label>Date</label><input id="ef-date" type="date" value="${i.date}"></div>
      <div class="fld"><label>Payment due date (optional)</label><input id="ef-due" type="date" value="${i.dueDate||''}"></div>
      <div class="fld"><label>Customer</label><input id="ef-cust" value="${i.customer||''}"></div><div class="fld"><label>Contact / Phone</label><input id="ef-contact" value="${i.contact||''}"></div>
      <div class="fld"><label>Telephone</label><input id="ef-phone" value="${escapeHtml(i.phone||'')}"></div><div class="fld"><label>Billing address</label><textarea id="ef-billing-address">${escapeHtml(i.billingAddress||'')}</textarea></div><div class="fld"><label>Email</label><input id="ef-email" value="${i.email||''}"></div><div class="fld"><label>Project</label><input id="ef-project" value="${i.project||''}"></div>
    </div><div class="fld"><label>Line Items</label></div><table id="ef-items"><tr><th>Code</th><th>Description</th><th>Supplier fabric / price basis</th><th>Qty</th><th>Selling / unit · internal cost</th><th></th></tr></table>
    <button class="btn sm" onclick="addEditItemRow()">+ Add line</button><div class="toolbar" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn gold" onclick="saveEditedInvoice('${id}')">Save Changes</button></div>`);
    (i.items||[]).forEach(addEditItemRow); if(!(i.items||[]).length)addEditItemRow();
  }
function addEditItemRow(item={}){appendDocumentItem('ef-items','ei',item,false);}
function saveEditedInvoice(id){
  const invoice=DB.invoices.find(x=>x.id===id);if(!invoice)return;
  const items=collectDocumentItems('ef-items','ei');if(!items)return;
  const nextId=fa('ef-no').trim();
  if(!nextId||!fa('ef-date')||!fa('ef-cust')||!items.length){toast('Complete invoice number, date, customer and line items');return;}
  if(!validInvoiceNo(nextId,fa('ef-date'))){toast('Invoice number must use BB or EE + YYYY/MM/DD + two-digit sequence, for example BB2026/09/0901');return;}
  if(DB.invoices.some(other=>other!==invoice&&other.id===nextId)){toast('This invoice number already exists');return;}
  Object.assign(invoice,{id:nextId,date:fa('ef-date'),dueDate:fa('ef-due'),customer:fa('ef-cust'),contact:fa('ef-contact'),phone:fa('ef-phone'),billingAddress:fa('ef-billing-address'),email:fa('ef-email'),project:fa('ef-project'),items});
  if(nextId!==id){
    for(const row of [...(DB.receipts||[]),...(DB.jobs||[]),...(DB.quotes||[])])if(row.invoiceId===id)row.invoiceId=nextId;
  }
  save();closeModal();toast('Invoice updated');render();
}
