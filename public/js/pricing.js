/* ---------- PRICING CALCULATOR ---------- */
function vPricing(c){
  c.innerHTML=`
  <div class="grid2">
  <div class="panel"><h3>Job Builder</h3>
    <div class="frm">
      <div class="fld"><label>Item (from price book)</label><select id="pc-item" onchange="loadPricePreset()">${DB.priceBook.map((p,i)=>`<option value="${i}">${p.code} — ${p.desc}</option>`).join('')}</select></div>
      <div class="fld"><label>Supplier fabric</label>${fabricSearchHtml('',true)}</div>
      <div class="fld"><label>Fabric price basis</label><select id="pc-fabric-price" onchange="priceCalculatorFabric()"><option value="">Choose fabric first…</option></select></div>
      <div class="fld"><label>Supplier VAT basis</label><select id="pc-fabric-vat" onchange="priceCalculatorFabric()"><option value="listed">As listed</option><option value="incl">Incl supplier VAT (15%)</option><option value="excl">Excl supplier VAT (15%)</option></select></div>
      <div class="fld"><label>Fabric quantity (items)</label><input id="pc-fqty" type="number" value="1" min="0" step="1" oninput="calcPrice()"></div>
      <div class="fld"><label id="pc-fabric-rate-label">Fabric (R/m)</label><input id="pc-fab" type="number" min="0" step="0.01" oninput="calcPrice()"></div>
      <div class="fld"><label id="pc-fabric-measure-label">Fabric metres / item</label><input id="pc-mtr" type="number" min="0" step="0.01" oninput="calcPrice()"></div>
      <div class="fld"><label>Consumables quantity (items)</label><input id="pc-mqty" type="number" value="1" min="0" step="1" oninput="calcPrice()"></div>
      <div class="fld"><label>Consumables / item (R)</label><input id="pc-mat" type="number" oninput="calcPrice()"></div>
      <div class="fld"><label>Labor rate (R/hr)</label><input id="pc-lrate" type="number" value="400" oninput="calcPrice()"></div>
      <div class="fld"><label>Labor quantity (items)</label><input id="pc-lqty" type="number" value="1" min="0" step="1" oninput="calcPrice()"></div>
      <div class="fld"><label>Labor hrs / item</label><input id="pc-lhrs" type="number" oninput="calcPrice()"></div>
      <div class="fld"><label>Markup % (on cost)</label><input id="pc-mu" type="number" value="20" oninput="calcPrice()"></div>
      <div class="fld"><label>Transport / extras (R)</label><input id="pc-extra" type="number" value="0" oninput="calcPrice()"></div>
    </div>
    <div id="pc-out"></div>
    <div class="toolbar" style="margin-top:12px"><button class="btn gold" onclick="quoteFromCalc()">→ Create Quote from this</button></div>
  </div>
  <div class="panel"><h3>Price Book (NEW PRICING formulas)</h3><div style="max-height:480px;overflow-y:auto"><table>
    <tr><th>Code</th><th>Description</th><th class="num">Fab m</th><th class="num">Fab R/m</th><th class="num">Sundries</th><th class="num">Lab hrs</th><th class="num">Est. price</th></tr>
    ${DB.priceBook.map((p,i)=>`<tr style="cursor:pointer" onclick="document.getElementById('pc-item').value=${i};loadPricePreset()"><td style="color:var(--gold2)">${p.code}</td><td>${p.desc}</td><td class="num">${p.mtr}</td><td class="num">${p.fabCost}</td><td class="num">${p.matCost}</td><td class="num">${p.labHr}</td><td class="num" id="pb-${i}"></td></tr>`).join('')}
  </table></div></div>
  </div>`;
  calcPrice();
}
function priceCalc(p,fqty,fab,mtr,mqty,mat,lqty,lrate,lhrs,mu,extra){
  const fabricQuantity=Math.max(0,Number(fqty)||0), consumableQuantity=Math.max(0,Number(mqty)||0), laborQuantity=Math.max(0,Number(lqty)||0);
  const fabT=fab*mtr*fabricQuantity, matT=mat*consumableQuantity, labT=lrate*lhrs*laborQuantity;
  const cost=fabT+matT+labT+ +extra;
  const sell=moneyRound(sellingFromCost(fab,mu)*mtr*fabricQuantity+sellingFromCost(mat,mu)*consumableQuantity+sellingFromCost(lrate*lhrs,mu)*laborQuantity+sellingFromCost(extra,mu));
  const units=Math.max(fabricQuantity,laborQuantity,consumableQuantity,1);
  return {fabT,matT,labT,cost,sell,each:sell/units,fabricQuantity,consumableQuantity,laborQuantity};
}
function loadPricePreset(){delete document.getElementById('pc-fab').dataset.t;calcPrice();}
function selectCalculatorFabric(){
  const input=document.getElementById('pc-fabric'),value=input.value.trim();
  const priorId=input.dataset.fabricId,priorInvalid=input.dataset.invalidFabric;
  delete input.dataset.fabricId;delete input.dataset.invalidFabric;
  if(!value){document.getElementById('pc-fabric-price').innerHTML='<option value="">Choose fabric first…</option>';document.getElementById('pc-fabric-rate-label').textContent='Fabric (R/m)';document.getElementById('pc-fabric-measure-label').textContent='Fabric metres / item';loadPricePreset();return;}
  const f=fabricCatalog().find(f=>fabricLookupLabel(f)===value);
  if(!f){input.dataset.invalidFabric='true';toast('Choose a fabric from the supplier search suggestions');return;}
  input.dataset.fabricId=f.id;
  recordRecentFabric(f.id);
  if(priorId===f.id&&!priorInvalid)return;
  const select=document.getElementById('pc-fabric-price');
  select.innerHTML=f.prices.map(p=>`<option value="${escapeHtml(p.key)}" ${p.amount==null?'disabled':''}>${escapeHtml(fabricPriceText(p))}</option>`).join('');select.value=fabricDefaultPrice(f)?.key||'';
  document.getElementById('pc-fabric-vat').value='listed';
  document.getElementById('pc-fabric-vat').disabled=f.prices.every(p=>p.vat==='unspecified');
  priceCalculatorFabric();
}
function calculatorFabricSnapshot(){
  const f=findFabric(document.getElementById('pc-fabric')?.dataset.fabricId);if(!f)return {};
  const p=f.prices.find(p=>p.key===document.getElementById('pc-fabric-price').value),vat=document.getElementById('pc-fabric-vat').value,source=fabricSource(f);
  return {fabricId:f.id,fabricPriceKey:p?.key,fabricVatBasis:vat,code:f.code,unit:p?.unit,
    fabricSource:{supplier:f.supplier,name:source.name,date:source.date,page:f.page,listedAmount:p?.amount,listedVat:p?.vat,unit:p?.unit,rate:fabricRate(p,vat)}};
}
function priceCalculatorFabric(){
  const snapshot=calculatorFabricSnapshot();if(!snapshot.fabricId)return;
  const f=findFabric(snapshot.fabricId),unit=snapshot.unit||'unit',input=document.getElementById('pc-fab');
  input.value=f.needsPriceConfirmation?'':snapshot.fabricSource.rate??'';input.dataset.t='1';
  document.getElementById('pc-fabric-rate-label').textContent=`Fabric (R/${unit})`;
  document.getElementById('pc-fabric-measure-label').textContent=`Fabric ${unit} / item${f.unitUnspecified?' (confirm supplier unit)':''}`;
  calcPrice();
}
function calcPrice(){
  const p=DB.priceBook[+document.getElementById('pc-item').value]||DB.priceBook[0];
  const g=id=>+document.getElementById(id).value||0;
  // prefill from price book when unchanged from defaults
  if(!document.getElementById('pc-fab').dataset.t){if(!document.getElementById('pc-fabric')?.dataset.fabricId)document.getElementById('pc-fab').value=p?.fabCost??0;document.getElementById('pc-mtr').value=p?.mtr??0;document.getElementById('pc-mat').value=p?.matCost??0;document.getElementById('pc-lhrs').value=p?.labHr??0;}
  document.getElementById('pc-fab').dataset.t=1;
  const r=priceCalc(p,g('pc-fqty'),g('pc-fab'),g('pc-mtr'),g('pc-mqty'),g('pc-mat'),g('pc-lqty'),g('pc-lrate'),g('pc-lhrs'),g('pc-mu'),g('pc-extra'));
  document.getElementById('pc-out').innerHTML=`
    <div class="kv"><span>Fabric total (${g('pc-mtr')}${escapeHtml(calculatorFabricSnapshot().unit||'m')} × ${R(g('pc-fab'))} per unit × ${r.fabricQuantity} fabric items)</span><b>${R(r.fabT)}</b></div>
    <div class="kv"><span>Consumables (${r.consumableQuantity} items × ${R(g('pc-mat'))})</span><b>${R(r.matT)}</b></div>
    <div class="kv"><span>Labor (${g('pc-lhrs')}h × ${R(g('pc-lrate'))}/h × ${r.laborQuantity} labor items)</span><b>${R(r.labT)}</b></div>
    <div class="kv"><span>Extras</span><b>${R(g('pc-extra'))}</b></div>
    <div class="kv"><span>Total cost</span><b>${R(r.cost)}</b></div>
    <div class="kv" style="font-size:15px"><span>CLIENT PRICE (+${g('pc-mu')}% markup)</span><b style="font-size:19px;color:var(--gold)">${R(r.sell)}</b></div>
    <div class="kv"><span>Each</span><b>${R(r.each)}</b></div>`;
  DB.priceBook.forEach((pb,i)=>{const rr=priceCalc(pb,1,pb.fabCost,pb.mtr,1,pb.matCost,1,400,pb.labHr,20,0);const el=document.getElementById('pb-'+i);if(el)el.textContent=R(rr.sell);});
}
function quoteFromCalc(){
  if(document.getElementById('pc-fabric')?.dataset.invalidFabric){toast('Choose a valid supplier fabric');return;}
  const numericFields=['pc-fqty','pc-fab','pc-mtr','pc-mqty','pc-mat','pc-lqty','pc-lrate','pc-lhrs','pc-mu','pc-extra'];
  if(numericFields.some(id=>{const value=document.getElementById(id).value;return value===''||!Number.isFinite(Number(value))||Number(value)<0;})){toast('Complete all calculator fields with non-negative numbers and a confirmed fabric price');return;}
  const g=id=>+document.getElementById(id).value||0;
  const p=DB.priceBook[+document.getElementById('pc-item').value];
  if(!p){toast('Choose an item from the price book');return;}
  const snapshot=calculatorFabricSnapshot(),f=findFabric(snapshot.fabricId),basis=f?.prices.find(p=>p.key===snapshot.fabricPriceKey);
  if(basis?.minimumExclusive!=null&&g('pc-mtr')*g('pc-fqty')<=basis.minimumExclusive){toast(`Bulk price requires over ${basis.minimumExclusive}${basis.unit} per colour`);return;}
  if(basis?.minimum!=null&&g('pc-mtr')*g('pc-fqty')<basis.minimum){toast(`Supplier minimum is ${basis.minimum}${basis.unit}`);return;}
  const r=priceCalc(p,g('pc-fqty'),g('pc-fab'),g('pc-mtr'),g('pc-mqty'),g('pc-mat'),g('pc-lqty'),g('pc-lrate'),g('pc-lhrs'),g('pc-mu'),g('pc-extra'));
  const qid=nextQuoteNo(today());
  const items=[
    {...snapshot,item:'Fabric',desc:f?`Fabric - ${f.desc}`:'Fabric',qty:r.fabricQuantity*g('pc-mtr'),price:g('pc-fab'),priceOverridden:snapshot.fabricSource?g('pc-fab')!==snapshot.fabricSource.rate:false},
    {item:'Consumables',desc:'Consumables',qty:r.consumableQuantity,price:g('pc-mat')},
    {item:'Labour',desc:'Labour - Upholster',qty:r.laborQuantity,price:g('pc-lrate')*g('pc-lhrs')},
    ...(g('pc-extra')>0?[{item:'Delivery',desc:'Delivery - Transport / extras',qty:1,price:g('pc-extra')}]:[]),
  ];
  items.forEach(item=>{item.unitCost=item.price;item.price=sellingFromCost(item.unitCost,g('pc-mu'));item.pricingMode='markup';item.markupPercent=g('pc-mu');});
  DB.quotes.unshift(initializeQuoteHistory({id:qid,date:today(),customer:'',contact:'',email:'',expiry:dateAfterDays(today()),projectReference:'',workType:'Reupholster',colour:'',introduction:`${p.desc} pricing calculation. ${r.fabricQuantity} fabric item(s), ${r.laborQuantity} labour item(s), ${r.consumableQuantity} consumables item(s).`,notes:'',items,status:'Draft',terms:true,reviewStatus:'Approved',includedInTotals:false,calculator:{markup:Number(document.getElementById('pc-mu').value)||0,total:r.sell}}));
  save();toast('Quote '+qid+' created from calculation');go('quotes');
}
