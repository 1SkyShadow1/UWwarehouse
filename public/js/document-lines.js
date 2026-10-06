function fabricPickerHtml(item={}){
  const f=findFabric(item.fabricId);
  return `${fabricSearchHtml(f?fabricLookupLabel(f):'')}
    <div class="fabric-basis"><label>Price basis<select class="line-fabric-price" aria-label="Fabric price basis" onchange="repriceFabricRow(this.closest('tr'))"><option value="">Choose fabric first…</option></select></label>
    <label>Supplier VAT basis<select class="line-fabric-vat" aria-label="Supplier VAT basis" onchange="repriceFabricRow(this.closest('tr'))"><option value="listed">As listed</option><option value="incl">Incl supplier VAT (15%)</option><option value="excl">Excl supplier VAT (15%)</option></select></label></div>
    <label class="fabric-colour-label">Selected colour<input class="line-colour" list="fabric-colours" value="${escapeHtml(item.colour||'')}" placeholder="Choose or type a colour" oninput="updateLineColour(this.closest('tr'))"><small>Confirm supplier availability.</small></label>
    <select class="line-fabric-unit" aria-label="Confirmed supplier unit" hidden onchange="repriceFabricRow(this.closest('tr'))"><option value="unit">Confirm unit…</option><option value="m">m</option><option value="m²">m²</option><option value="side/hide">side/hide</option></select>
    <small class="line-fabric-info" style="display:block;max-width:340px;white-space:normal"></small>`;
}
function appendDocumentItem(tableId,prefix,item={},code=true){
  const table=document.getElementById(tableId);if(!table)return;
  table.classList.add('document-line-editor');
  const tr=document.createElement('tr');tr._lineItem={...item};tr.dataset.prefix=prefix;
  const selected=item.fabricId?'Fabric':item.item||(item.desc?'Other':'');
  tr.innerHTML=`<td class="line-category"><label>Item<select class="${prefix}-item" aria-label="Item category" onchange="changeLineCategory(this.closest('tr'))"><option value="">Choose Item…</option>${quoteItemOptions(selected)}</select></label></td>
    ${code?`<td class="line-code"><label>Code<input class="${prefix}-code" value="${escapeHtml(item.code||'')}"></label></td>`:''}
    <td class="line-description"><label>Description<input class="${prefix}-desc" value="${escapeHtml(item.desc||'')}" oninput="updateLinePricing(this.closest('tr'))"></label></td>
    <td class="line-quantity"><label>Qty<input class="${prefix}-qty" aria-label="Quantity" type="number" min="0" step="0.01" value="${escapeHtml(item.qty??1)}" oninput="updateFabricLineInfo(this.closest('tr'))"></label></td>
    <td class="line-selling"><label>Selling / unit<input class="${prefix}-price" aria-label="Unit price" type="number" min="0" step="0.01" value="${escapeHtml(item.price??0)}" oninput="updateLinePricing(this.closest('tr'),'selling');updateFabricLineInfo(this.closest('tr'))"></label>${linePricingHtml(item,prefix)}</td>
    <td class="line-selection"><div class="line-fabric-controls">${fabricPickerHtml(item)}</div>${linePresetHtml(item)}</td>
    <td class="line-remove"><button class="btn sm danger" aria-label="Remove line" onclick="const table=this.closest('table');this.closest('tr').remove();updateDocumentProfit(table)">✕</button></td>`;
  table.appendChild(tr);
  if(!document.getElementById('fabric-colours'))table.insertAdjacentHTML('afterend',fabricColourOptions());
  changeLineCategory(tr,false);
  if(item.fabricId)configureFabricRow(tr,item.fabricPriceKey,item.fabricVatBasis);
  updateLinePricing(tr);
}
function changeLineCategory(tr,changed=true){
  const prefix=tr.dataset.prefix,category=tr.querySelector(`.${prefix}-item`).value;
  const controls=tr.querySelector('.line-fabric-controls');controls.hidden=category!=='Fabric';
  controls.querySelectorAll('input,select,button').forEach(el=>el.disabled=category!=='Fabric');
  if(category==='Fabric'&&!findFabric(tr._lineItem.fabricId)){
    tr.querySelector('.line-fabric-price').disabled=true;tr.querySelector('.line-fabric-vat').disabled=true;
  }
  tr.querySelector('.line-preset').hidden=category==='Fabric';
  if(changed){
    if(category!=='Fabric'){
      if(tr._lineItem.fabricId){
        tr.querySelector(`.${prefix}-price`).value='';tr.querySelector('.line-cost').value='';tr.querySelector('.line-pricing-mode').value='manual';
        const desc=tr.querySelector(`.${prefix}-desc`);if(/^Fabric\b/.test(desc.value))desc.value=category;
        const code=tr.querySelector(`.${prefix}-code`);if(code&&code.value===findFabric(tr._lineItem.fabricId)?.code)code.value='';
      }
      for(const key of ['fabricId','fabricSource','fabricPriceKey','fabricVatBasis','priceOverridden','unit','colour'])delete tr._lineItem[key];
      delete tr.dataset.invalidFabric;tr.querySelector('.line-fabric').value='';tr.querySelector('.line-colour').value='';tr.querySelector('.line-fabric-info').textContent='';
      tr.querySelector('.line-fabric-price').innerHTML='<option value="">Choose fabric first…</option>';
    }
    const description=tr.querySelector(`.${prefix}-desc`),previous=tr._lineItem.item;
    if(!description.value.trim()||description.value===previous||description.value===`Fabric - ${tr._lineItem.fabricDescription||''}`)description.value=category;
    tr._lineItem.item=category;
  }
  filterLinePresets(tr);updateLinePricing(tr);
}
function updateLineColour(tr){
  tr._lineItem.colour=tr.querySelector('.line-colour').value.trim();
  if(tr._lineItem.fabricId)tr.querySelector(`.${tr.dataset.prefix}-desc`).value=`Fabric - ${findFabric(tr._lineItem.fabricId)?.desc||''}${tr._lineItem.colour?' - '+tr._lineItem.colour:''}`;
}
function configureFabricRow(tr,key,vat='listed'){
  const f=findFabric(tr._lineItem.fabricId);if(!f)return;
  tr.querySelector('.fabric-supplier').value=f.supplier;
  const select=tr.querySelector('.line-fabric-price');
  select.disabled=false;
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
  if(tr.querySelector(`.${tr.dataset.prefix}-item`).value!=='Fabric')return;
  if(!value){
    const hadFabric=!!tr._lineItem.fabricId;
    for(const key of ['fabricId','fabricSource','fabricPriceKey','fabricVatBasis','priceOverridden','unit'])delete tr._lineItem[key];
    if(hadFabric){
      tr.querySelector('.line-cost').value='';tr.querySelector(`.${tr.dataset.prefix}-price`).value='';
      tr.querySelector('.line-pricing-mode').value='manual';tr.querySelector(`.${tr.dataset.prefix}-desc`).value='Fabric';
      updateLinePricing(tr);
    }
    delete tr.dataset.invalidFabric;tr.querySelector('.line-fabric-price').innerHTML='<option value="">Price basis…</option>';
    tr.querySelector('.line-fabric-price').disabled=true;tr.querySelector('.line-fabric-vat').disabled=true;
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
  if(tr.querySelector(`.${tr.dataset.prefix}-item`).value!=='Fabric')return;
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
  tr._lineItem.fabricDescription=f.desc;
  tr.querySelector(`.${prefix}-desc`).value=`Fabric - ${f.desc}${tr._lineItem.colour?' - '+tr._lineItem.colour:''}`;
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
    const category=tr.querySelector(`.${prefix}-item`).value;
    if(!category){toast('Choose an Item category for each line');return null;}
    if(category!=='Fabric'&&tr._lineItem?.fabricId){toast('Supplier fabric pricing applies only to Fabric items');return null;}
    const qtyInput=tr.querySelector(`.${prefix}-qty`),priceInput=tr.querySelector(`.${prefix}-price`);
    const qty=Number(qtyInput.value),price=Number(priceInput.value);
    if(tr.dataset.invalidFabric||!desc||qtyInput.value===''||priceInput.value===''||!Number.isFinite(qty)||!Number.isFinite(price)||!Number.isFinite(qty*price)||qty<0||price<0){toast('Complete each line with a valid fabric selection, description, non-negative quantity and confirmed selling price');return null;}
    const f=findFabric(tr._lineItem?.fabricId),p=f?.prices.find(p=>p.key===tr.querySelector('.line-fabric-price').value);
    if(p?.minimumExclusive!=null&&qty<=p.minimumExclusive){toast(`Bulk price requires over ${p.minimumExclusive}${p.unit} per colour`);return null;}
    if(p?.minimum!=null&&qty<p.minimum){toast(`Supplier minimum is ${p.minimum}${p.unit}`);return null;}
    const cost=tr.querySelector('.line-cost').value,markup=tr.querySelector('.line-markup').value,mode=tr.querySelector('.line-pricing-mode').value;
    if((cost!==''&&(!Number.isFinite(Number(cost))||!Number.isFinite(qty*Number(cost))||Number(cost)<0))||markup===''||!Number.isFinite(Number(markup))||Number(markup)<0||((mode==='markup'||tr._lineItem.fabricId)&&cost==='')){toast('Enter a confirmed non-negative cost and markup, or choose manual pricing for a line without a recorded cost');return null;}
    const item={...tr._lineItem,unitCost:cost===''?null:Number(cost),markupPercent:Number(markup),pricingMode:mode,code:tr.querySelector(`.${prefix}-code`)?.value??tr._lineItem?.code??'',desc,
      item:category,qty,price};
    item.desc=documentLineDescription(item);
    if(item.fabricSource)item.priceOverridden=price!==item.fabricSource.rate;
    items.push(item);
  }
  return items;
}
