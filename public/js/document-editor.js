function newInvoice(mode='invoice'){
  window.invoiceFormMode=mode;
  const initialDate=today(), initialPrefix='BB';
  const numberFunction=mode==='quote'?'nextQuoteNo':'nextInvoiceNo';
  const prefixField=`<div class="fld"><label>${mode==='quote'?'Quote':'Invoice'} initials</label><select id="f-prefix" onchange="document.getElementById('f-no').value=${numberFunction}(document.getElementById('f-date').value,this.value)"><option value="BB">BB</option><option value="SS">SS</option></select></div>`;
  const dateHandler=`document.getElementById('f-no').value=${numberFunction}(this.value,document.getElementById('f-prefix').value)`;
  modal(`<h3>New Invoice</h3>
  <div class="frm">
    <div class="fld"><label>${mode==='quote'?'Quote No':'Invoice No'}</label><input id="f-no" value="${mode==='quote'?nextQuoteNo(initialDate):nextInvoiceNo(initialDate,initialPrefix)}" ${mode==='quote'?'readonly':''}></div>
    ${prefixField}
    <div class="fld"><label>Date</label><input id="f-date" type="date" value="${initialDate}" onchange="${dateHandler};if(document.getElementById('f-expiry'))document.getElementById('f-expiry').value=dateAfterDays(this.value)"></div>
    ${mode==='quote'?`<div class="fld"><label>Valid until</label><input id="f-expiry" type="date" value="${dateAfterDays(initialDate)}"></div>`:''}
    ${mode==='invoice'?'<div class="fld"><label>Payment due date (optional)</label><input id="f-due" type="date"></div><div class="fld"><label>Order number</label><input id="f-order-no"></div><div class="fld"><label>Client VAT number</label><input id="f-vat-no"></div>':`<div class="fld"><label>Prepared by</label><input id="f-prepared-by" value="${escapeHtml(window.UW_OPERATOR?.name||'')}"></div>`}
    <div class="fld"><label>Customer</label><input id="f-cust"></div>
    <div class="fld"><label>Contact name</label><input id="f-contact"></div><div class="fld"><label>Telephone</label><input id="f-phone"></div>
    <div class="fld"><label>Email</label><input id="f-email"></div><div class="fld"><label>Billing address</label><textarea id="f-billing-address" rows="2"></textarea></div>
    <div class="fld"><label>${mode==='quote'?'Project Reference':'Project'}</label><input id="f-project" value="${mode==='quote'?'':'Re-Upholstery'}"></div>
    ${mode==='quote'?`    <div class="fld"><label>Number of items</label><input id="f-qty" type="number" min="1" step="1" value="1" onchange="refreshQuotePreset()"></div>
    <div class="fld"><label>Work type</label><select id="f-work-type" onchange="refreshQuotePreset()"><option>Manufacturing</option><option>Repair</option><option selected>Reupholster</option></select></div>
    <div class="fld"><label>Material metres per item</label><input id="f-length" type="number" min="0" step="0.01" placeholder="Use preset length" onchange="refreshQuotePreset()"></div>
    <div class="fld"><label>Fabric colour</label><input id="f-colour" list="fabric-colours" placeholder="Choose or type any colour" onchange="refreshQuotePreset()"><small>Confirm this colour with the selected supplier.</small></div>`:''}
  </div>
  ${mode==='quote'?quotePresetPickerHtml()+fabricColourOptions():''}
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
function addItemRow(item={}){appendDocumentItem('f-items','i',item);}
function saveInvoice(){
  const items=collectDocumentItems('f-items','i');if(!items)return;
  const common={id:document.getElementById('f-no').value,date:document.getElementById('f-date').value,customer:document.getElementById('f-cust').value,contact:document.getElementById('f-contact').value,phone:document.getElementById('f-phone').value,billingAddress:document.getElementById('f-billing-address').value,email:document.getElementById('f-email').value,items};
  if(!common.id||!common.date||!common.customer||!items.length){toast('Enter invoice number, date, customer and at least one line item');return;}
  const collection=window.invoiceFormMode==='quote'?DB.quotes:DB.invoices;
  if(collection.some(doc=>doc.id===common.id)){toast('This document number already exists');return;}
  if(window.invoiceFormMode==='quote'){
    if(!validQuoteNo(common.id,common.date)){toast('Quote number must use BB or SS + YYMMDD + daily sequence, for example BB26100701');return;}
    const expiry=fa('f-expiry');if(!validQuoteExpiry(common.date,expiry)){toast('Quote expiry must be on or after its date');return;}
    DB.quotes.unshift(initializeQuoteHistory({...common,expiry,preparedBy:fa('f-prepared-by'),projectReference:document.getElementById('f-project').value,workType:document.getElementById('f-work-type')?.value||'Reupholster',colour:document.getElementById('f-colour')?.value||'',introduction:document.getElementById('f-introduction')?.value||'',notes:document.getElementById('f-introduction')?.value||'',status:'Draft',terms:true,reviewStatus:'Approved',includedInTotals:false}));
    save();closeModal();toast('Quote '+common.id+' created');go('quotes');
  }else{
    if(!validInvoiceNo(common.id,common.date)){toast('Invoice number must use BB or SS + YYMMDD + daily sequence, for example BB26100701');return;}
    const inv={...common,dueDate:fa('f-due'),orderNo:fa('f-order-no'),vatNo:fa('f-vat-no'),project:document.getElementById('f-project').value,deposit:0,paid:0,status:'Pending',fy:DB.meta.fy};
    DB.invoices.unshift(inv);save();closeModal();toast('Invoice '+inv.id+' created');render();
  }
}
function editInvoice(id){
    const i=DB.invoices.find(x=>x.id===id); if(!i)return;
    modal(`<h3>Edit Invoice ${i.id}</h3><div class="frm">
      <div class="fld"><label>Invoice No</label><input id="ef-no" value="${i.id}"></div><div class="fld"><label>Date</label><input id="ef-date" type="date" value="${i.date}"></div>
      <div class="fld"><label>Payment due date (optional)</label><input id="ef-due" type="date" value="${i.dueDate||''}"></div>
      <div class="fld"><label>Order number</label><input id="ef-order-no" value="${escapeHtml(i.orderNo||'')}"></div><div class="fld"><label>Client VAT number</label><input id="ef-vat-no" value="${escapeHtml(i.vatNo||'')}"></div><div class="fld"><label>Customer</label><input id="ef-cust" value="${i.customer||''}"></div><div class="fld"><label>Contact name</label><input id="ef-contact" value="${i.contact||''}"></div>
      <div class="fld"><label>Telephone</label><input id="ef-phone" value="${escapeHtml(i.phone||'')}"></div><div class="fld"><label>Billing address</label><textarea id="ef-billing-address">${escapeHtml(i.billingAddress||'')}</textarea></div><div class="fld"><label>Email</label><input id="ef-email" value="${i.email||''}"></div><div class="fld"><label>Project</label><input id="ef-project" value="${i.project||''}"></div>
    </div><div class="fld"><label>Line Items</label></div><table id="ef-items"><tr><th>Code</th><th>Description</th><th>Supplier fabric / price basis</th><th>Qty</th><th>Selling / unit · internal cost</th><th></th></tr></table>
    <button class="btn sm" onclick="addEditItemRow()">+ Add line</button><div class="toolbar" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn gold" onclick="saveEditedInvoice('${id}')">Save Changes</button></div>`);
    (i.items||[]).forEach(addEditItemRow); if(!(i.items||[]).length)addEditItemRow();
  }
function addEditItemRow(item={}){appendDocumentItem('ef-items','ei',item);}
function saveEditedInvoice(id){
  const invoice=DB.invoices.find(x=>x.id===id);if(!invoice)return;
  const items=collectDocumentItems('ef-items','ei');if(!items)return;
  const nextId=fa('ef-no').trim();
  if(!nextId||!fa('ef-date')||!fa('ef-cust')||!items.length){toast('Complete invoice number, date, customer and line items');return;}
  if(nextId!==id&&!validInvoiceNo(nextId,fa('ef-date'))){toast('Invoice number must use BB or SS + YYMMDD + daily sequence, for example BB26100701');return;}
  if(DB.invoices.some(other=>other!==invoice&&other.id===nextId)){toast('This invoice number already exists');return;}
  Object.assign(invoice,{id:nextId,date:fa('ef-date'),dueDate:fa('ef-due'),orderNo:fa('ef-order-no'),vatNo:fa('ef-vat-no'),customer:fa('ef-cust'),contact:fa('ef-contact'),phone:fa('ef-phone'),billingAddress:fa('ef-billing-address'),email:fa('ef-email'),project:fa('ef-project'),items});
  if(nextId!==id){
    for(const row of [...(DB.receipts||[]),...(DB.jobs||[]),...(DB.quotes||[])])if(row.invoiceId===id)row.invoiceId=nextId;
  }
  save();closeModal();toast('Invoice updated');render();
}
