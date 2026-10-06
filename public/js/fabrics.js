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
