// Search results are bounded; source identity and every price basis remain visible.
function fabricSearchHtml(value='',calculator=false){
  const suppliers=[...new Set(fabricCatalog().map(f=>f.supplier))].sort();
  return `<div class="fabric-search" style="min-width:260px;max-width:420px;white-space:normal">
    <select class="fabric-supplier" aria-label="Filter fabric supplier" onchange="renderFabricResults(this.parentElement,true)"><option value="">All suppliers</option>${suppliers.map(s=>`<option>${escapeHtml(s)}</option>`).join('')}</select>
    <select class="fabric-scope" aria-label="Fabric shortcuts" onchange="renderFabricResults(this.parentElement,true)"><option value="">All fabrics</option><option value="favorites">Favourites</option><option value="recent">Recently used</option></select>
    <input ${calculator?'id="pc-fabric"':''} class="fabric-query ${calculator?'':'line-fabric'}" aria-label="Search supplier fabric" autocomplete="off" placeholder="Search design, code or colour…" style="width:100%" value="${escapeHtml(value)}" oninput="renderFabricResults(this.parentElement)" onfocus="renderFabricResults(this.parentElement)" onkeydown="fabricSearchKey(event)" onchange="fabricSearchChange(this)">
    <div class="fabric-results" aria-label="Fabric search results" hidden style="max-height:260px;overflow:auto;border:1px solid var(--line);padding:5px"></div></div>`;
}
function matchingFabrics(query,supplier,scope=''){
  const terms=String(query).toLowerCase().trim().split(/\s+/).filter(Boolean);
  const preferences=DB.meta?.fabricPicker||{},ids=scope==='favorites'?preferences.favoriteIds:scope==='recent'?preferences.recentIds:null;
  const matches=fabricCatalog().filter(f=>(!scope||(ids||[]).includes(f.id))&&(!supplier||f.supplier===supplier)&&terms.every(term=>`${fabricLookupLabel(f)} ${f.code||''}`.toLowerCase().includes(term)));
  return scope==='recent'?matches.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id)):matches;
}
function renderFabricResults(host,browseSupplier=false){
  const input=host.querySelector('.fabric-query'),box=host.querySelector('.fabric-results'),all=matchingFabrics(browseSupplier?'':input.value,host.querySelector('.fabric-supplier').value,host.querySelector('.fabric-scope').value);
  const favorites=DB.meta?.fabricPicker?.favoriteIds||[];
  box.hidden=false;
  box.innerHTML=`<small>${all.length} match(es)${all.length>12?' · refine search to see more':''}</small>`+all.slice(0,12).map(f=>`<div style="display:flex;align-items:start;gap:4px"><button type="button" class="btn fabric-result" data-fabric-id="${escapeHtml(f.id)}" style="display:block;width:100%;text-align:left;white-space:normal;margin-top:5px" onclick="chooseSearchFabric(this)"><b>${escapeHtml(f.supplier+' — '+f.desc)}</b><br>${escapeHtml(f.colours||f.code||'')}<br><small>${escapeHtml(fabricSource(f).date||'User-entered')} · ${f.sheet?'row':'page'} ${f.page||'—'}<br>${escapeHtml((f.prices||[]).map(fabricPriceText).join(' · '))}</small></button><button type="button" class="btn fabric-favorite" aria-label="Favourite ${escapeHtml(f.desc)}" aria-pressed="${favorites.includes(f.id)}" data-fabric-id="${escapeHtml(f.id)}" onclick="toggleFavoriteFabric(this)">${favorites.includes(f.id)?'★':'☆'}</button></div>`).join('');
}
function recordRecentFabric(id){
  DB.meta=DB.meta||{};const prefs=DB.meta.fabricPicker=DB.meta.fabricPicker||{};
  prefs.recentIds=[id,...(prefs.recentIds||[]).filter(other=>other!==id)].slice(0,10);save();
}
function toggleFavoriteFabric(button){
  DB.meta=DB.meta||{};const prefs=DB.meta.fabricPicker=DB.meta.fabricPicker||{},id=button.dataset.fabricId;
  prefs.favoriteIds=(prefs.favoriteIds||[]).includes(id)?prefs.favoriteIds.filter(other=>other!==id):[...(prefs.favoriteIds||[]),id];
  save();renderFabricResults(button.closest('.fabric-search'),true);
}
function fabricSearchChange(input){
  const value=input.value.trim(),exact=!value||fabricCatalog().some(f=>fabricLookupLabel(f)===value||f.id===value);
  if(exact){if(input.id==='pc-fabric')selectCalculatorFabric();else selectLineFabric(input);}
  else if(input.id==='pc-fabric')input.dataset.invalidFabric='true';
  else input.closest('tr').dataset.invalidFabric='true';
}
function chooseSearchFabric(button){
  const host=button.closest('.fabric-search'),input=host.querySelector('.fabric-query'),f=findFabric(button.dataset.fabricId);if(!f)return;
  input.value=fabricLookupLabel(f);
  if(input.id==='pc-fabric')selectCalculatorFabric();else selectLineFabric(input);
  host.querySelector('.fabric-results').hidden=true;input.focus();host.querySelector('.fabric-results').hidden=true;
}
function fabricSearchKey(event){
  const host=event.target.closest('.fabric-search'),box=host.querySelector('.fabric-results'),buttons=[...box.querySelectorAll('.fabric-result')];
  if(event.key==='Escape'){box.hidden=true;return;}
  if(event.key==='ArrowDown'){event.preventDefault();if(box.hidden)renderFabricResults(host);host.querySelector('.fabric-result')?.focus();}
  if(event.key==='Enter'&&!box.hidden&&buttons.length===1){event.preventDefault();chooseSearchFabric(buttons[0]);}
}
document.addEventListener('keydown',event=>{
  const button=event.target.closest('.fabric-result');if(!button)return;
  const buttons=[...button.closest('.fabric-results').querySelectorAll('.fabric-result')],index=buttons.indexOf(button);
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
  if(event.key==='Escape'){button.closest('.fabric-results').hidden=true;button.closest('.fabric-search').querySelector('input').focus();button.closest('.fabric-results').hidden=true;}
});
document.addEventListener('click',event=>{document.querySelectorAll('.fabric-search').forEach(host=>{if(!host.contains(event.target))host.querySelector('.fabric-results').hidden=true;});});
