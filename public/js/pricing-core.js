// Shared, DOM-free arithmetic. Document `price` remains the customer unit rate.
function moneyRound(value){return Math.round((Number(value)+Number.EPSILON)*100)/100;}
function sellingFromCost(cost,markup){return moneyRound(Number(cost)*(1+Number(markup)/100));}
function lineProfit(item){
  const quantity=Number(item.qty),price=Number(item.price);
  const known=item.unitCost!==''&&item.unitCost!=null&&Number.isFinite(Number(item.unitCost));
  const sell=moneyRound(quantity*price),cost=known?moneyRound(quantity*Number(item.unitCost)):null;
  return {sell,cost,profit:known?moneyRound(sell-cost):null,margin:known&&sell>0?(sell-cost)/sell*100:null};
}
function documentProfit(items){
  const lines=items.map(lineProfit),sell=moneyRound(items.reduce((s,x)=>s+Number(x.qty)*Number(x.price),0));
  // Match the established invoice/PDF convention: round after aggregating quantities.
  const complete=lines.every(x=>x.cost!==null),knownCost=moneyRound(items.reduce((sum,item,index)=>sum+(lines[index].cost===null?0:Number(item.qty)*Number(item.unitCost)),0));
  return {sell,knownCost,complete,profit:complete?moneyRound(sell-knownCost):null,margin:complete&&sell>0?(sell-knownCost)/sell*100:null};
}
function linePricingHtml(item,prefix){
  const cost=item.unitCost??item.fabricSource?.rate??'';
  return `<label style="display:block">Cost / unit<input class="line-cost" aria-label="Unit cost" type="number" min="0" step="0.01" value="${escapeHtml(cost)}" oninput="updateLinePricing(this.closest('tr'),'cost')"></label>
    <label style="display:block">Pricing<select class="line-pricing-mode" aria-label="Selling price calculation" onchange="updateLinePricing(this.closest('tr'),'mode')"><option value="manual">Manual selling price</option><option value="markup" ${item.pricingMode==='markup'?'selected':''}>Cost + markup</option></select></label>
    <label style="display:block">Markup %<input class="line-markup" aria-label="Markup percentage" type="number" min="0" step="0.01" value="${escapeHtml(item.markupPercent??0)}" oninput="updateLinePricing(this.closest('tr'),'markup')"></label>
    <small class="line-profit" style="display:block;white-space:normal;max-width:210px"></small>`;
}
function updateLinePricing(tr,reason='display'){
  const prefix=tr.dataset.prefix,cost=tr.querySelector('.line-cost'),markup=tr.querySelector('.line-markup'),mode=tr.querySelector('.line-pricing-mode'),price=tr.querySelector(`.${prefix}-price`);
  if(!cost||!price)return;
  if(reason==='selling')mode.value='manual';
  if(reason==='markup')mode.value='markup';
  if(['cost','markup','mode','supplier'].includes(reason)&&mode.value==='markup'){
    price.value=cost.value!==''&&markup.value!==''&&Number.isFinite(Number(cost.value))&&Number.isFinite(Number(markup.value))?sellingFromCost(cost.value,markup.value):'';
  }
  if(tr._lineItem&&(reason==='selling'||reason==='supplier'||(mode.value==='markup'&&['cost','markup','mode'].includes(reason))))tr._lineItem.historicalPricing=false;
  const p=lineProfit({qty:tr.querySelector(`.${prefix}-qty`).value,price:price.value,unitCost:cost.value});
  tr.querySelector('.line-profit').textContent=price.value===''?'Enter selling price':p.cost===null?'Cost not recorded; margin unavailable':`Cost ${R(p.cost)} · Sell ${R(p.sell)} · Profit ${R(p.profit)}${p.margin===null?'':` · Margin ${p.margin.toFixed(1)}%`}${p.profit<=0?' · At or below cost':''}`;
  if(tr._lineItem?.historicalPricing)tr.querySelector('.line-profit').textContent+=' · Historical source rate; check current pricing';
  updateDocumentProfit(tr.closest('table'));
}
function updateDocumentProfit(table){
  if(!table)return;
  let summary=document.getElementById(table.id+'-profit');
  if(!summary){summary=document.createElement('p');summary.id=table.id+'-profit';summary.style.color='var(--muted)';table.after(summary);}
  const rows=[...table.querySelectorAll('tr')].slice(1).filter(tr=>tr.querySelector(`.${tr.dataset.prefix}-desc`)?.value.trim());
  const items=rows.map(tr=>({qty:tr.querySelector(`.${tr.dataset.prefix}-qty`).value,price:tr.querySelector(`.${tr.dataset.prefix}-price`).value,unitCost:tr.querySelector('.line-cost').value}));
  const p=documentProfit(items);
  summary.textContent=`Internal pricing: Selling total ${R(p.sell)} · Recorded cost ${R(p.knownCost)} · ${p.complete&&items.length?`Profit ${R(p.profit)}${p.margin===null?'':` · Margin ${p.margin.toFixed(1)}%`}`:'Some costs missing; total margin unavailable'}. Cost uses the selected supplier VAT basis.`;
}
