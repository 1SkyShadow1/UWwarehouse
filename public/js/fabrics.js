/* ---------- FABRICS ---------- */
// The supplier catalog stays in the existing static bundle. Only document price
// snapshots and user-added fabrics use the application's existing database.
function fabricCatalog(){
  const bundled=window.UW_FABRIC_CATALOG?.fabrics||[];
  const historical=[...(window.UW_IMPORTED?.fabrics||[]),...(seed.fabrics||[])];
  const same=(a,b)=>['supplier','code','desc','cost','markup','sell'].every(k=>a[k]===b[k]);
  const local=(DB.fabrics||[]).map((f,index)=>({...f,id:f.id||`local-fabric-${index}`,localIndex:index,
    prices:[{key:'cost',label:'Entered cost',amount:f.cost,vat:'unspecified',unit:f.unit||'m'},
            {key:'sell',label:'Entered selling price',amount:f.sell,vat:'unspecified',unit:f.unit||'m'}]}))
    .filter(f=>!bundled.length||!historical.some(old=>same(f,old)));
  return [...bundled,...local];
}
function findFabric(id){return fabricCatalog().find(f=>f.id===id);}
function fabricSource(f){return window.UW_FABRIC_CATALOG?.sources?.[f?.sourceId]||{};}
function fabricLookupLabel(f){
  const variant=f.colours||f.fields?.['RANGE / ALTERNATIVE NAME']||f.fields?.RANGE||f.fields?.Collection||'';
  const width=f.fields?.WIDTH||f.fields?.['WIDTH CM']||f.fields?.['Width (cm)']||f.fields?.['USEABLE WIDTH']||'';
  const source=fabricSource(f),location=source.date?`${source.date} ${f.sheet?'row':'p'}${f.page}`:`local entry ${(f.localIndex??0)+1}`;
  return `${f.supplier} — ${f.desc}${variant?' — '+variant:''}${width?' — '+width:''}${f.code&&f.code!==f.desc?' — '+f.code:''} — ${location}`;
}
function fabricDefaultPrice(f){
  return ['cut','cash','retail','area','cost','roll'].map(key=>(f.prices||[]).find(p=>p.key===key&&Number.isFinite(p.amount)))
    .find(Boolean)||(f.prices||[]).find(p=>Number.isFinite(p.amount));
}
function fabricRate(price,vatBasis='listed'){
  if(!price||!Number.isFinite(price.amount)||price.amount<0)return null;
  let amount=price.amount;
  if(vatBasis==='incl'&&price.vat==='excl')amount=Number.isFinite(price.amountIncl)?price.amountIncl:amount*1.15;
  if(vatBasis==='excl'&&price.vat==='incl')amount=amount/1.15;
  return Math.round((amount+Number.EPSILON)*100)/100;
}
function fabricPriceText(p){return `${p.label}: ${p.amount==null?'Unavailable':R(p.amount)} /${p.unit} (${p.vat==='excl'?'excl VAT':p.vat==='incl'?'incl VAT':'VAT unspecified'})`;}
function fabricPickerHtml(item={}){
  const f=findFabric(item.fabricId);
  return `${fabricSearchHtml(f?fabricLookupLabel(f):'')}
    <div style="display:flex;gap:4px;margin-top:4px"><select class="line-fabric-price" aria-label="Fabric price basis" style="max-width:170px" onchange="repriceFabricRow(this.closest('tr'))"><option value="">Price basis…</option></select>
    <select class="line-fabric-vat" aria-label="Supplier VAT basis" style="width:170px;max-width:170px" onchange="repriceFabricRow(this.closest('tr'))"><option value="listed">As listed</option><option value="incl">Incl supplier VAT (15%)</option><option value="excl">Excl supplier VAT (15%)</option></select></div>
    <select class="line-fabric-unit" aria-label="Confirmed supplier unit" hidden onchange="repriceFabricRow(this.closest('tr'))"><option value="unit">Confirm unit…</option><option value="m">m</option><option value="m²">m²</option><option value="side/hide">side/hide</option></select>
    <small class="line-fabric-info" style="display:block;max-width:340px;white-space:normal"></small>`;
}
function appendDocumentItem(tableId,prefix,item={},category=false,code=true){
  const table=document.getElementById(tableId);if(!table)return;
  const tr=document.createElement('tr');tr._lineItem={...item};tr.dataset.prefix=prefix;
  tr.innerHTML=`${code?`<td><input style="width:85px" class="${prefix}-code" value="${escapeHtml(item.code||'')}"></td>`:''}
    <td><input style="width:100%;min-width:150px" class="${prefix}-desc" value="${escapeHtml(item.desc||'')}" oninput="updateLinePricing(this.closest('tr'))"></td>
    <td>${fabricPickerHtml(item)}</td>
    ${category?`<td><select class="${prefix}-item" style="width:130px;max-width:130px"><option value="">Select category…</option>${quoteItemOptions(item.item||'')}</select></td>`:''}
    <td><input style="width:75px" class="${prefix}-qty" aria-label="Quantity" type="number" min="0" step="0.01" value="${escapeHtml(item.qty??1)}" oninput="updateFabricLineInfo(this.closest('tr'))"></td>
    <td><input style="width:100px" class="${prefix}-price" aria-label="Unit price" type="number" min="0" step="0.01" value="${escapeHtml(item.price??0)}" oninput="updateLinePricing(this.closest('tr'),'selling');updateFabricLineInfo(this.closest('tr'))">${linePricingHtml(item,prefix)}</td>
    <td><button class="btn sm danger" onclick="const table=this.closest('table');this.closest('tr').remove();updateDocumentProfit(table)">✕</button></td>`;
  table.appendChild(tr);
  if(item.fabricId)configureFabricRow(tr,item.fabricPriceKey,item.fabricVatBasis);
  updateLinePricing(tr);
}
function configureFabricRow(tr,key,vat='listed'){
  const f=findFabric(tr._lineItem.fabricId);if(!f)return;
  const select=tr.querySelector('.line-fabric-price');
  select.innerHTML=(f.prices||[]).map(p=>`<option value="${escapeHtml(p.key)}" ${p.amount==null?'disabled':''}>${escapeHtml(fabricPriceText(p))}</option>`).join('');
  select.value=key||fabricDefaultPrice(f)?.key||'';
  tr.querySelector('.line-fabric-vat').value=vat||'listed';
  tr.querySelector('.line-fabric-unit').hidden=!f.unitUnspecified;
  tr.querySelector('.line-fabric-unit').value=f.unitUnspecified?(tr._lineItem.unit||'unit'):'unit';
  // Unspecified supplier VAT cannot be inferred from a manual record.
  tr.querySelector('.line-fabric-vat').disabled=(f.prices||[]).every(p=>p.vat==='unspecified');
  updateFabricLineInfo(tr);
}
function selectLineFabric(input){
  const tr=input.closest('tr'),value=input.value.trim();
  if(!value){
    delete tr._lineItem.fabricId;delete tr._lineItem.fabricSource;delete tr._lineItem.fabricPriceKey;delete tr._lineItem.fabricVatBasis;
    delete tr.dataset.invalidFabric;tr.querySelector('.line-fabric-price').innerHTML='<option value="">Price basis…</option>';
    tr.querySelector('.line-fabric-info').textContent='';return;
  }
  const matches=fabricCatalog().filter(f=>fabricLookupLabel(f)===value||f.id===value);
  if(matches.length!==1){tr.dataset.invalidFabric='true';toast('Choose a fabric from the supplier search suggestions');return;}
  if(matches[0].id===tr._lineItem.fabricId&&!tr.dataset.invalidFabric){input.value=fabricLookupLabel(matches[0]);return;}
  delete tr.dataset.invalidFabric;
  const f=matches[0];tr._lineItem.fabricId=f.id;tr._lineItem.unit=fabricDefaultPrice(f)?.unit||'unit';input.value=fabricLookupLabel(f);
  configureFabricRow(tr);repriceFabricRow(tr);
  recordRecentFabric(f.id);
  const results=input.closest('.fabric-search')?.querySelector('.fabric-results');if(results)results.hidden=true;
}
function repriceFabricRow(tr){
  const f=findFabric(tr._lineItem.fabricId);if(!f)return;
  const key=tr.querySelector('.line-fabric-price').value,vat=tr.querySelector('.line-fabric-vat').value;
  const p=f.prices.find(p=>p.key===key),rate=fabricRate(p,vat),prefix=tr.dataset.prefix;
  const costRate=f.localIndex!=null&&key==='sell'?Number(f.cost):rate;
  const unit=f.unitUnspecified?tr.querySelector('.line-fabric-unit').value:p?.unit;
  const source=fabricSource(f);
  tr._lineItem={...tr._lineItem,fabricPriceKey:key,fabricVatBasis:vat,unit:unit||'',
    fabricSource:{supplier:f.supplier,name:source.name||'User-entered fabric',date:source.date||'',page:f.page||'',
      listedAmount:p?.amount,listedVat:p?.vat,listedUnit:p?.unit,unit,rate,costRate}};
  const code=tr.querySelector(`.${prefix}-code`);if(code)code.value=f.code;
  tr.querySelector(`.${prefix}-desc`).value=`${f.supplier} — ${f.desc}${f.colours?' — '+f.colours:''} (${unit||'unit'}; ${p?.label||'price unavailable'}${p?.approximate?'; approximate':''})`;
  const category=tr.querySelector(`.${prefix}-item`);if(category)category.value='Fabric';
  tr.querySelector('.line-cost').value=costRate==null||!Number.isFinite(costRate)||f.needsPriceConfirmation?'':costRate;
  tr.querySelector('.line-pricing-mode').value=f.localIndex!=null&&key==='sell'?'manual':'markup';
  tr.querySelector(`.${prefix}-price`).value=rate==null||f.needsPriceConfirmation?'':rate;
  updateLinePricing(tr,'supplier');
  updateFabricLineInfo(tr);
}
function updateFabricLineInfo(tr){
  updateLinePricing(tr);
  const info=tr.querySelector('.line-fabric-info');if(!info)return;
  const f=findFabric(tr._lineItem.fabricId);if(!f){
    if(tr._lineItem.fabricSource)info.textContent=`Saved supplier rate: ${R(tr._lineItem.price)} /${tr._lineItem.unit||'unit'}`;
    return;
  }
  const p=f.prices.find(p=>p.key===tr.querySelector('.line-fabric-price').value),prefix=tr.dataset.prefix;
  const qty=Number(tr.querySelector(`.${prefix}-qty`).value),priceInput=tr.querySelector(`.${prefix}-price`),rate=Number(priceInput.value);
  const source=fabricSource(f),warnings=[];
  if(f.unitUnspecified&&tr._lineItem.unit==='unit')warnings.push('Supplier unit unspecified — confirm unit');
  if(f.needsPriceConfirmation)warnings.push('Zero price in source — enter confirmed supplier price');
  if(p?.approximate)warnings.push('Approximate hide price — confirm actual hide size/amount');
  if(p?.minimumExclusive!=null&&qty<=p.minimumExclusive)warnings.push(`Requires over ${p.minimumExclusive}${p.unit} per colour, COD`);
  if(f.needsStockConfirmation||/discontinued|check stock/i.test(JSON.stringify(f.fields)))warnings.push('Check supplier stock');
  if(/full hides only/i.test(JSON.stringify(f.fields)))warnings.push('Full hides only — confirm actual hide area');
  if(p?.minimum!=null&&qty<p.minimum)warnings.push(`Minimum ${p.minimum}${p.unit}`);
  const vatChoice=tr.querySelector('.line-fabric-vat').value,effectiveVat=vatChoice==='listed'?p?.vat:vatChoice;
  const vatLabel=effectiveVat==='incl'?'incl supplier VAT':effectiveVat==='excl'?'excl supplier VAT':'VAT unspecified';
  info.textContent=`Qty in ${tr._lineItem.unit||p?.unit||'units'} · ${vatLabel} · ${priceInput.value!==''&&Number.isFinite(qty)&&Number.isFinite(rate)?'Line total '+R(qty*rate):'Enter confirmed price'} · ${tr._lineItem.fabricSource?.date||source.date||'User-entered'}${warnings.length?' · '+warnings.join(' · '):''}`;
}
function collectDocumentItems(tableId,prefix){
  const items=[];
  for(const tr of [...document.querySelectorAll(`#${tableId} tr`)].slice(1)){
    const desc=tr.querySelector(`.${prefix}-desc`).value.trim();
    if(!desc&&!tr._lineItem?.fabricId)continue;
    const qtyInput=tr.querySelector(`.${prefix}-qty`),priceInput=tr.querySelector(`.${prefix}-price`);
    const qty=Number(qtyInput.value),price=Number(priceInput.value);
    if(tr.dataset.invalidFabric||!desc||qtyInput.value===''||priceInput.value===''||!Number.isFinite(qty)||!Number.isFinite(price)||!Number.isFinite(qty*price)||qty<0||price<0){toast('Complete each line with a valid fabric selection, description, non-negative quantity and confirmed selling price');return null;}
    const f=findFabric(tr._lineItem?.fabricId),p=f?.prices.find(p=>p.key===tr.querySelector('.line-fabric-price').value);
    if(p?.minimumExclusive!=null&&qty<=p.minimumExclusive){toast(`Bulk price requires over ${p.minimumExclusive}${p.unit} per colour`);return null;}
    if(p?.minimum!=null&&qty<p.minimum){toast(`Supplier minimum is ${p.minimum}${p.unit}`);return null;}
    const cost=tr.querySelector('.line-cost').value,markup=tr.querySelector('.line-markup').value,mode=tr.querySelector('.line-pricing-mode').value;
    if((cost!==''&&(!Number.isFinite(Number(cost))||!Number.isFinite(qty*Number(cost))||Number(cost)<0))||markup===''||!Number.isFinite(Number(markup))||Number(markup)<0||((mode==='markup'||tr._lineItem.fabricId)&&cost==='')){toast('Enter a confirmed non-negative cost and markup, or choose manual pricing for a line without a recorded cost');return null;}
    const item={...tr._lineItem,unitCost:cost===''?null:Number(cost),markupPercent:Number(markup),pricingMode:mode,code:tr.querySelector(`.${prefix}-code`)?.value??tr._lineItem?.code??'',desc,
      item:tr.querySelector(`.${prefix}-item`)?.value||tr._lineItem?.item||'',qty,price};
    if(item.fabricSource)item.priceOverridden=price!==item.fabricSource.rate;
    items.push(item);
  }
  return items;
}
function vFabrics(c){
  const all=fabricCatalog();
  const rows=all.filter(f=>docMatches({...f,description:JSON.stringify(f.fields||{})},'fabrics',f.supplier));
  const suppliers=[...new Set(all.map(f=>f.supplier))].sort();
  c.innerHTML=`<div class="toolbar">
    ${docFilterHtml('fabrics',suppliers,[],false)}
    <button class="btn gold" onclick="newFabric()">+ Add Fabric</button></div>
  <p style="color:var(--muted)">${rows.length} of ${all.length} supplier fabrics and materials. Prices reflect the supplied dated lists. Select a fabric on any quote or invoice line to fill its rate; choose roll/cut/area/hide and VAT basis explicitly. No automatic markup is added.</p>
  <div class="panel" style="overflow:auto"><table><tr><th>Supplier / list date</th><th>Fabric Code / Design</th><th>Range / colours</th><th>Source prices & units</th><th>Specifications</th><th></th></tr>
  ${rows.map(f=>`<tr><td>${escapeHtml(f.supplier)}<small style="display:block">${escapeHtml(fabricSource(f).date||'User-entered')}</small></td>
    <td>${escapeHtml(f.code)}<small style="display:block">${escapeHtml(f.desc)}</small></td>
    <td style="max-width:250px;white-space:normal">${escapeHtml(f.colours||f.fields?.RANGE||f.fields?.Collection||f.fields?.['RANGE / ALTERNATIVE NAME']||'—')}</td>
    <td style="white-space:normal">${(f.prices||[]).map(p=>`<div>${escapeHtml(fabricPriceText(p))}${p.approximate?' · approximate':''}</div>`).join('')}${f.needsPriceConfirmation?'<b>Price requires confirmation</b>':''}${f.unitUnspecified?'<div>Confirm supplier unit</div>':''}</td>
    <td><button class="btn sm" onclick="viewFabricDetails('${f.id}')">All fields / source</button></td>
    <td>${f.localIndex!=null?`<button class="btn sm danger" onclick="deleteLocalFabric('${f.id}')">✕</button>`:''}</td></tr>`).join('')||'<tr><td colspan="6">No fabrics match these filters.</td></tr>'}
  </table></div>`;
}
function viewFabricDetails(id){
  const f=findFabric(id);if(!f)return;const source=fabricSource(f);
  modal(`<h3>${escapeHtml(f.supplier+' — '+f.desc)}</h3><p>${escapeHtml(source.name||'User-entered fabric')} · ${escapeHtml(source.date||'')}${f.sheet?' · '+escapeHtml(f.sheet)+' row '+f.page:' · PDF page '+(f.page||'—')}</p>
    <div class="panel" style="max-height:55vh;overflow:auto"><table>${Object.entries(f.fields||{Supplier:f.supplier,Code:f.code,Description:f.desc,Cost:f.cost,Markup:f.markup,Selling:f.sell,Unit:f.unit||'m'}).map(([k,v])=>`<tr><th>${escapeHtml(k)}</th><td style="white-space:normal">${escapeHtml(v==null||v===''?'Not provided':v)}</td></tr>`).join('')}</table>
    <h4>List notes / care key / terms</h4><p style="white-space:pre-wrap">${escapeHtml(source.notes||'No additional notes supplied.')}</p></div>
    <div class="toolbar"><button class="btn" onclick="closeModal()">Close</button>${source.path?`<button class="btn gold" onclick="openFabricSource('${f.id}')">View original document</button>`:''}</div>`);
}
function openFabricSource(id){const f=findFabric(id),s=fabricSource(f);if(s.path)viewDocument({name:s.name,path:s.path});}
function deleteLocalFabric(id){const f=findFabric(id);if(f?.localIndex==null)return;if(!confirm('Delete this manually added fabric? Saved invoice and quote prices are retained.'))return;DB.fabrics.splice(f.localIndex,1);save();render();}
function newFabric(){
  modal(`<h3>Add Fabric Price</h3><div class="frm">
    <div class="fld"><label>Supplier</label><input id="fa-sup"></div>
    <div class="fld"><label>Code</label><input id="fa-code"></div>
    <div class="fld"><label>Description</label><input id="fa-desc"></div>
    <div class="fld"><label>Unit</label><select id="fa-unit"><option value="m">m</option><option value="m²">m²</option><option value="side/hide">side/hide</option><option value="unit">unit</option></select></div>
    <div class="fld"><label>Cost per unit (R)</label><input id="fa-cost" type="number" min="0" step="0.01" oninput="document.getElementById('fa-sell').value=((+this.value)*(1+(+document.getElementById('fa-mu').value)/100)).toFixed(2)"></div>
    <div class="fld"><label>Markup %</label><input id="fa-mu" type="number" value="100" oninput="document.getElementById('fa-sell').value=((+document.getElementById('fa-cost').value)*(1+(+this.value)/100)).toFixed(2)"></div>
    <div class="fld"><label>Selling per unit (R)</label><input id="fa-sell" type="number" min="0" step="0.01"></div>
  </div>
  <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" onclick="closeModal()">Cancel</button>
  <button class="btn gold" onclick="saveNewFabric()">Save</button></div>`);
}
function saveNewFabric(){
  const supplier=fa('fa-sup').trim(),code=fa('fa-code').trim(),desc=fa('fa-desc').trim();
  const cost=Number(fa('fa-cost')),markup=Number(fa('fa-mu')),sell=Number(fa('fa-sell'));
  if(!supplier||!code||!desc||['fa-cost','fa-mu','fa-sell'].some(id=>fa(id)==='')||[cost,markup,sell].some(x=>!Number.isFinite(x)||x<0)){toast('Enter supplier, code, description and non-negative prices/markup');return;}
  DB.fabrics=DB.fabrics||[];DB.fabrics.push({id:'local-fabric-'+crypto.randomUUID(),supplier,code,desc,cost,markup,sell,unit:fa('fa-unit')});save();closeModal();toast('Fabric added');render();
}
const fa=id=>document.getElementById(id).value;
