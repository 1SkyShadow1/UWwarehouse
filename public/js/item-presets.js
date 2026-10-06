// Preset selection is explicit: changing quantity, colour or search never deletes lines.
function archiveJobPresets(){return window.UW_ITEM_PRESETS?.recipes||[];}
function quotePresets(){return [...(Array.isArray(DB.priceBook)?DB.priceBook:[]),...archiveJobPresets(),...archiveLinePresets().map(p=>({...p,code:p.item,lines:[p]}))];}
function archiveLinePresets(category=''){
  return (window.UW_ITEM_PRESETS?.presets||[]).filter(p=>!category||p.item===category);
}
function fabricColourOptions(){
  const colours=['Black','White','Ivory','Cream','Ecru','Natural','Pearl','Off White','Beige','Sand','Desert','Dessert','Stone','Oatmeal','Linen','Taupe','Mushroom','Mocha','Chocolate','Brown','Tan','Camel','Cognac','Caramel','Coffee','Walnut','Grey','Light Grey','Silver','Sterling','Slate','Graphite','Charcoal','Anthracite','Navy','Midnight Blue','Royal Blue','Cobalt','Denim','Sky Blue','Powder Blue','Duck Egg','Teal','Turquoise','Aqua','Petrol','Emerald','Forest Green','Olive','Sage','Mint','Pistachio','Khaki','Lime','Mustard','Gold','Ochre','Yellow','Rust','Terracotta','Copper','Orange','Coral','Peach','Blush','Dusty Pink','Rose','Magenta','Red','Burgundy','Wine','Maroon','Plum','Purple','Lilac','Lavender','Violet','Multi-colour'];
  return `<datalist id="fabric-colours">${colours.map(c=>`<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>`;
}
function quotePresetPickerHtml(){
  return `<section class="preset-panel"><h4>Build from a previous item</h4><div class="preset-controls"><label>Find a size, type or material<input id="preset-query" type="search" placeholder="Search sofa, chair, cushion…" oninput="filterQuotePresets()"></label><label>Preset type<select id="preset-type" onchange="filterQuotePresets()"><option value="">All presets</option>${['Complete item','Fabric','Foam','Labour','Consumables','Delivery','Other'].map(c=>`<option>${c}</option>`).join('')}</select></label><label>Item preset<select id="f-preset" onchange="previewQuotePreset()"><option value="">Choose an item preset…</option>${quotePresets().map((p,i)=>`<option value="${i}" data-category="${escapeHtml(p.originalJobQuantities||!p.lines?'Complete item':p.item)}">${escapeHtml(p.code||'')} — ${escapeHtml(p.desc||'Priced item')}${p.originalJobQuantities?' · '+R(p.total):''}${p.sourceDate?' · '+escapeHtml(p.sourceDate):''}</option>`).join('')}</select></label><button id="preset-add" type="button" class="btn gold" disabled onclick="applyQuotePreset(document.getElementById('f-preset').value)">Add preset lines</button></div><p id="preset-preview">${quotePresets().length} presets available. Choose a preset to review its quantities and rates. Adding a preset keeps existing lines.</p><small>Historical rates need checking before issuing a quote. Fabric lines use current supplier pricing when you choose a fabric.</small></section>`;
}
function filterQuotePresets(){
  const query=document.getElementById('preset-query').value.trim().toLowerCase();
  const category=document.getElementById('preset-type').value,select=document.getElementById('f-preset');
  for(const option of select.options)option.hidden=!!option.value&&(!option.textContent.toLowerCase().includes(query)||(category&&option.dataset.category!==category));
  if(select.selectedOptions[0]?.hidden)select.value='';previewQuotePreset();
}
function previewQuotePreset(){
  const value=document.getElementById('f-preset')?.value,p=value===''?null:quotePresets()[Number(value)];
  const preview=document.getElementById('preset-preview');if(!preview)return;
  document.getElementById('preset-add').disabled=!p;
  const quantityLabel=document.getElementById('f-qty')?.parentElement.querySelector('label');if(quantityLabel)quantityLabel.textContent=p?.originalJobQuantities?'Repeat original job (multiplier)':'Number of items';
  preview.textContent=p?(p.originalJobQuantities?`${p.desc} · ${p.lines.length} original lines · Previous bundle ${R(p.total)}. Keeps original job quantities; confirm measurements and current rates.`:p.lines?(p.price==null?`${p.item} · Description found in previous documents. Enter a confirmed rate.`:`${p.item} · Historical source rate ${R(p.price)} per documented unit. Check quantity and current rate before use.`):`${p.desc} · Fabric ${p.mtr||0}m per item · Historical fabric ${R(p.fabCost||0)}/m · Materials ${R(p.matCost||0)} · Labour ${p.labHr||0} hours. Confirm rates before use.`):'Choose an item preset to review its quantities and rates.';
}
function refreshQuotePreset(){previewQuotePreset();}
function presetNumber(value){return value!==''&&value!=null&&Number.isFinite(Number(value))?Number(value):null;}
function quotePresetLines(preset,quantity=1,lengthOverride=null,colour=''){
  const count=Math.max(1,Number(quantity)||1),length=presetNumber(lengthOverride??preset?.mtr);
  if(preset.lines)return preset.lines.map(line=>({...line,price:line.price??'',desc:documentLineDescription({...line,desc:line.lineDesc||line.desc}),qty:(line.qty||1)*count,unitCost:null,markupPercent:0,pricingMode:'manual',historicalPricing:true,presetSourceId:line.sourceId}));
  return [
    {item:'Fabric',desc:`Fabric${colour?' - '+colour:''}`,colour,qty:length==null?'':length*count,price:presetNumber(preset?.fabCost)??''},
    {item:'Consumables',desc:'Consumables - Materials allowance',qty:count,price:presetNumber(preset?.matCost)??''},
    {item:'Labour',desc:'Labour - Upholster',qty:count,price:presetNumber(preset?.labHr)==null?'':Number(preset.labHr)*400},
  ].map(line=>({...line,unitCost:null,markupPercent:0,pricingMode:'manual',historicalPricing:true}));
}
function applyQuotePreset(index,select){
  if(index===''||index==null)return;
  const preset=quotePresets()[Number(index)];if(!preset)return;
  const quantity=Number(document.getElementById('f-qty')?.value);
  const lengthValue=document.getElementById('f-length')?.value||'';
  if(!Number.isInteger(quantity)||quantity<1){toast('Enter a positive whole number of items or job repetitions');return;}
  if(lengthValue!==''&&(!Number.isFinite(Number(lengthValue))||Number(lengthValue)<0)){toast('Enter a non-negative material length');return;}
  const workType=document.getElementById('f-work-type')?.value||'Reupholster',length=presetNumber(lengthValue!==''?lengthValue:preset.mtr);
  const colour=document.getElementById('f-colour')?.value.trim()||'';
  const introduction=document.getElementById('f-introduction');
  if(introduction&&(preset.originalJobQuantities||!preset.lines)){
    const job=preset.originalJobQuantities?`${preset.desc} to be ${workType.toLowerCase()}.`:`${quantity} x ${preset.desc||'Item'} to be ${workType.toLowerCase()}${length==null?'':` in ${length}m${colour?' '+colour:''} fabric`}.`;
    introduction.value=[introduction.value.trim(),job].filter(Boolean).join('\n');
  }
  const project=document.getElementById('f-project');if(project&&!project.value.trim()&&(preset.originalJobQuantities||!preset.lines))project.value=preset.desc||'';
  const table=document.getElementById('f-items');
  if(table){
    for(const row of [...table.querySelectorAll('tr')].slice(1))if(!row.querySelector('.i-desc')?.value.trim()&&!row._lineItem?.fabricId)row.remove();
    quotePresetLines(preset,quantity,length,colour).forEach(line=>addItemRow({...line,code:preset.lines?(line.code||''):String(preset.code||'')}));
  }
  if(select)select.blur();
}
function linePresetHtml(item={}){
  return `<div class="line-preset"><label>Find a previous line<input class="line-preset-query" type="search" placeholder="Search work or materials…" oninput="filterLinePresets(this.closest('tr'))"></label><label>Previous quote / invoice line<select class="line-preset-choice" onchange="applyHistoricalLine(this.closest('tr'),this.value)"><option value="">Choose a line or type your own description…</option></select></label><small class="line-preset-info">Choose an Item to browse previous work and materials.</small></div>`;
}
function filterLinePresets(tr){
  const category=tr.querySelector(`.${tr.dataset.prefix}-item`).value;
  const query=tr.querySelector('.line-preset-query').value.trim().toLowerCase();
  const select=tr.querySelector('.line-preset-choice');
  const presets=archiveLinePresets(category).filter(p=>p.desc.toLowerCase().includes(query));
  select.innerHTML='<option value="">Choose a line or type your own description…</option>'+presets.slice(0,100).map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.desc)} · ${p.price==null?'Enter rate':R(p.price)+' (historical'+(p.sourceDate?' '+escapeHtml(p.sourceDate):'')+')'}</option>`).join('');
  tr.querySelector('.line-preset-info').textContent=category?`${presets.length} previous ${category.toLowerCase()} lines. Search to narrow results; check historical rates.`:'Choose an Item to browse previous work and materials.';
}
function applyHistoricalLine(tr,id){
  const p=archiveLinePresets().find(p=>p.id===id);if(!p)return;
  const prefix=tr.dataset.prefix;
  if(tr.querySelector(`.${prefix}-item`).value!==p.item)return;
  tr._lineItem.historicalPricing=true;tr._lineItem.presetSourceId=p.sourceId;
  tr.querySelector(`.${prefix}-desc`).value=documentLineDescription({...p,desc:p.lineDesc||p.desc});
  tr.querySelector(`.${prefix}-price`).value=p.price??'';
  tr.querySelector('.line-cost').value='';tr.querySelector('.line-pricing-mode').value='manual';
  updateLinePricing(tr);tr.querySelector('.line-preset-info').textContent=p.price==null?'Description found in previous documents. Enter a confirmed rate.':`Historical source rate ${R(p.price)}. Confirm the current selling rate; internal cost has not been set.`;
}
