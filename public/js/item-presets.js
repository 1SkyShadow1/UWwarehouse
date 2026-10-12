// Preset selection is explicit: changing quantity, colour or search never deletes lines.
function archiveJobPresets(){return window.UW_ITEM_PRESETS?.recipes||[];}
function quotePresets(){return [...(Array.isArray(DB.priceBook)?DB.priceBook:[]),...archiveJobPresets(),...archiveLinePresets().map(p=>({...p,code:p.code||p.item,lines:[p]}))];}
function savedLinePresets(){return Object.values(DB.meta?.savedItemPresets||{});}
function itemCodeStem(line){
  const text=String(line.desc||'').toLowerCase();
  if(line.item==='Other'||!line.item){
    if(/couch|sofa|seater|suite/.test(text))return `${/reclin/.test(text)?'REC':/sleeper/.test(text)?'SLP':/l[ -]?shape/.test(text)?'LSH':'STD'}-COU`;
    if(/chair|wingback/.test(text))return `${/wingback/.test(text)?'WIN':/dining/.test(text)?'DIN':/kitchen/.test(text)?'KIT':/office/.test(text)?'OFF':/tub/.test(text)?'TUB':'STD'}-CHR`;
  }
  const category=({Fabric:'FAB',Foam:'FOA',Labour:'LAB',Consumables:'CON',Delivery:'DEL'})[line.item]||'ITM';
  const words=text.replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w&&!['fabric','foam','labour','consumables','delivery','other','the','and','with','for','of','to'].includes(w));
  const detail=/frame/.test(text)?'FRA':/glue/.test(text)?'GLU':/upholster/.test(text)?'UPH':/stitch/.test(text)?'STI':/cushion/.test(text)?'CUS':/cotton/.test(text)?'COT':/thread/.test(text)?'THR':(words[0]||'GEN').slice(0,3).toUpperCase();
  return `${category}-${detail}`;
}
function registerDocumentItemPresets(items){
  const saved={...(DB.meta?.savedItemPresets||{})};
  const identity=line=>JSON.stringify([line.item,String(line.desc||'').trim().toLowerCase(),Number(line.price),line.unitCost??null,line.markupPercent??30,line.pricingMode||'manual',line.unit||'',line.fabricId||'',line.colour||'']);
  const codes=new Set([...quotePresets().map(p=>p.code),...(DB.invoices||[]).flatMap(d=>(d.items||[]).map(i=>i.code)),...(DB.quotes||[]).flatMap(d=>(d.items||[]).map(i=>i.code)),...items.map(i=>i.code)].filter(Boolean).map(code=>String(code).trim().toUpperCase()));
  for(const line of items){
    if(String(line.code||'').trim())continue;
    const existing=Object.values(saved).find(p=>identity(p)===identity(line));
    if(existing){line.code=existing.code;continue;}
    const stem=itemCodeStem(line);let sequence=1;
    while(codes.has(`${stem}-${sequence}`))sequence++;
    const code=`${stem}-${sequence}`;
    codes.add(code);line.code=code;
    const preset={id:code,code,item:line.item,desc:line.desc,qty:1,price:line.price,unitCost:line.unitCost??null,markupPercent:line.markupPercent??30,pricingMode:line.pricingMode||'manual',savedPreset:true};
    for(const key of ['unit','fabricId','colour'])if(line[key])preset[key]=line[key];
    saved[code]=preset;
  }
  DB.meta={...DB.meta,savedItemPresets:saved};
  return items;
}
function archiveLinePresets(category=''){
  return [...(window.UW_ITEM_PRESETS?.presets||[]),...savedLinePresets()].filter(p=>!category||p.item===category);
}
function fabricColourOptions(){
  const colours=['Black','White','Ivory','Cream','Ecru','Natural','Pearl','Off White','Beige','Sand','Desert','Dessert','Stone','Oatmeal','Linen','Taupe','Mushroom','Mocha','Chocolate','Brown','Tan','Camel','Cognac','Caramel','Coffee','Walnut','Grey','Light Grey','Silver','Sterling','Slate','Graphite','Charcoal','Anthracite','Navy','Midnight Blue','Royal Blue','Cobalt','Denim','Sky Blue','Powder Blue','Duck Egg','Teal','Turquoise','Aqua','Petrol','Emerald','Forest Green','Olive','Sage','Mint','Pistachio','Khaki','Lime','Mustard','Gold','Ochre','Yellow','Rust','Terracotta','Copper','Orange','Coral','Peach','Blush','Dusty Pink','Rose','Magenta','Red','Burgundy','Wine','Maroon','Plum','Purple','Lilac','Lavender','Violet','Multi-colour'];
  return `<datalist id="fabric-colours">${colours.map(c=>`<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>`;
}
function quotePresetPickerHtml(tableId='f-items',prefix='i',formPrefix='f'){
  return `<section class="preset-panel" data-table="${tableId}" data-prefix="${prefix}" data-form="${formPrefix}"><h4>Build from a previous item</h4><div class="preset-controls"><label>Find a size, type or material<input id="preset-query" type="search" placeholder="Search sofa, chair, cushion…" oninput="filterQuotePresets()"></label><label>Preset type<select id="preset-type" onchange="filterQuotePresets()"><option value="">All presets</option>${['Complete item','Fabric','Foam','Labour','Consumables','Delivery','Other'].map(c=>`<option>${c}</option>`).join('')}</select></label><label>Item preset<select id="f-preset" onchange="previewQuotePreset()"><option value="">Choose an item preset…</option>${quotePresets().map((p,i)=>`<option value="${i}" data-category="${escapeHtml(p.originalJobQuantities||!p.lines?'Complete item':p.item)}">${escapeHtml(p.code||'')} — ${escapeHtml(p.desc||'Priced item')}${p.originalJobQuantities?' · '+R(p.total):''}${p.sourceDate?' · '+escapeHtml(p.sourceDate):''}</option>`).join('')}</select></label><button id="preset-add" type="button" class="btn gold" disabled onclick="applyQuotePreset(document.getElementById('f-preset').value)">Add preset lines</button></div><p id="preset-preview">${quotePresets().length} presets available. Choose a preset to review its quantities and rates. Adding a preset keeps existing lines.</p><small>Historical rates need checking before issuing a quote. Fabric lines use current supplier pricing when you choose a fabric.</small></section>`;
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
  preview.textContent=p?(p.originalJobQuantities?`${p.desc} · ${p.lines.length} original lines · Previous bundle ${R(p.total)}. Keeps original job quantities; confirm measurements and current rates.`:p.lines?(p.price==null?`${p.item} · Description found in previous documents. Enter a confirmed rate.`:`${p.item} · ${p.savedPreset?'Saved selling rate':'Historical source rate'} ${R(p.price)} per documented unit. Check quantity and current rate before use.`):`${p.desc} · Fabric ${p.mtr||0}m per item · Historical fabric ${R(p.fabCost||0)}/m · Materials ${R(p.matCost||0)} · Labour ${p.labHr||0} hours. Confirm rates before use.`):'Choose an item preset to review its quantities and rates.';
}
function refreshQuotePreset(){previewQuotePreset();}
function presetNumber(value){return value!==''&&value!=null&&Number.isFinite(Number(value))?Number(value):null;}
function quotePresetLines(preset,quantity=1,lengthOverride=null,colour=''){
  const count=Math.max(1,Number(quantity)||1),length=presetNumber(lengthOverride??preset?.mtr);
  if(preset.lines)return preset.lines.map(line=>({...line,price:line.price??'',desc:documentLineDescription({...line,desc:line.lineDesc||line.desc}),qty:(line.qty||1)*count,unitCost:line.savedPreset?line.unitCost:null,markupPercent:line.savedPreset?line.markupPercent:30,pricingMode:line.savedPreset?line.pricingMode:'manual',historicalPricing:!line.savedPreset,presetSourceId:line.sourceId}));
  return [
    {item:'Fabric',desc:`Fabric${colour?' - '+colour:''}`,colour,qty:length==null?'':length*count,price:presetNumber(preset?.fabCost)??''},
    {item:'Consumables',desc:'Consumables - Materials allowance',qty:count,price:presetNumber(preset?.matCost)??''},
    {item:'Labour',desc:'Labour - Upholster',qty:count,price:presetNumber(preset?.labHr)==null?'':Number(preset.labHr)*400},
  ].map(line=>({...line,unitCost:null,markupPercent:30,pricingMode:'manual',historicalPricing:true}));
}
function applyQuotePreset(index,select){
  if(index===''||index==null)return;
  const preset=quotePresets()[Number(index)];if(!preset)return;
  const panel=document.querySelector('.preset-panel'),tableId=panel?.dataset.table||'f-items',prefix=panel?.dataset.prefix||'i',formPrefix=panel?.dataset.form||'f';
  const quantity=Number(document.getElementById(formPrefix+'-qty')?.value||1);
  const lengthValue=document.getElementById(formPrefix+'-length')?.value||'';
  if(!Number.isInteger(quantity)||quantity<1){toast('Enter a positive whole number of items or job repetitions');return;}
  if(lengthValue!==''&&(!Number.isFinite(Number(lengthValue))||Number(lengthValue)<0)){toast('Enter a non-negative material length');return;}
  const workType=document.getElementById(formPrefix+'-work-type')?.value||'Reupholster',length=presetNumber(lengthValue!==''?lengthValue:preset.mtr);
  const colour=document.getElementById(formPrefix+'-colour')?.value.trim()||'';
  const introduction=document.getElementById(formPrefix+'-introduction');
  if(introduction&&(preset.originalJobQuantities||!preset.lines)){
    const job=preset.originalJobQuantities?`${preset.desc} to be ${workType.toLowerCase()}.`:`${quantity} x ${preset.desc||'Item'} to be ${workType.toLowerCase()}${length==null?'':` in ${length}m${colour?' '+colour:''} fabric`}.`;
    introduction.value=[introduction.value.trim(),job].filter(Boolean).join('\n');
  }
  const project=document.getElementById(formPrefix+'-project');if(project&&!project.value.trim()&&(preset.originalJobQuantities||!preset.lines))project.value=preset.desc||'';
  const table=document.getElementById(tableId);
  if(table){
    for(const row of [...table.querySelectorAll('tr')].slice(1))if(!row.querySelector(`.${prefix}-desc`)?.value.trim()&&!row._lineItem?.fabricId)row.remove();
    quotePresetLines(preset,quantity,length,colour).forEach(line=>appendDocumentItem(tableId,prefix,{...line,code:preset.lines?(line.code||''):String(preset.code||'')}));
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
  select.innerHTML='<option value="">Choose a line or type your own description…</option>'+presets.slice(0,100).map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.desc)} · ${p.price==null?'Enter rate':R(p.price)+(p.savedPreset?' (saved)':' (historical'+(p.sourceDate?' '+escapeHtml(p.sourceDate):'')+')')}</option>`).join('');
  tr.querySelector('.line-preset-info').textContent=category?`${presets.length} previous ${category.toLowerCase()} lines. Search to narrow results; check historical rates.`:'Choose an Item to browse previous work and materials.';
}
function applyHistoricalLine(tr,id){
  const p=archiveLinePresets().find(p=>p.id===id);if(!p)return;
  const prefix=tr.dataset.prefix;
  if(tr.querySelector(`.${prefix}-item`).value!==p.item)return;
  tr._lineItem.historicalPricing=!p.savedPreset;tr._lineItem.presetSourceId=p.sourceId;
  tr._lineItem={...tr._lineItem,...(p.savedPreset?p:{})};
  if(p.code&&tr.querySelector(`.${prefix}-code`))tr.querySelector(`.${prefix}-code`).value=p.code;
  tr.querySelector(`.${prefix}-desc`).value=documentLineDescription({...p,desc:p.lineDesc||p.desc});
  tr.querySelector(`.${prefix}-price`).value=p.price??'';
  tr.querySelector('.line-cost').value=p.savedPreset?(p.unitCost??''):'';tr.querySelector('.line-pricing-mode').value=p.savedPreset?p.pricingMode:'manual';
  tr.querySelector('.line-markup').value=p.savedPreset?p.markupPercent:30;
  updateLinePricing(tr);tr.querySelector('.line-preset-info').textContent=p.price==null?'Description found in previous documents. Enter a confirmed rate.':p.savedPreset?`Saved selling rate ${R(p.price)}; confirm the current cost before issuing.`:`Historical source rate ${R(p.price)}. Confirm the current selling rate; internal cost has not been set.`;
}
