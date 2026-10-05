function isStockReference(stock){return /price\s*list/i.test(String(stock.unit||''));}
function stockNeedsReorder(stock){
  return !isStockReference(stock)&&stock.quantity!==''&&stock.quantity!=null&&stock.reorderLevel!==''&&stock.reorderLevel!=null&&Number.isFinite(Number(stock.quantity))&&Number.isFinite(Number(stock.reorderLevel))&&Number(stock.quantity)<=Number(stock.reorderLevel);
}
function supplierFabricCoverage(){
  return Object.entries(window.UW_FABRIC_CATALOG?.sources||{}).map(([id,source])=>({
    id,name:source.supplier,date:source.date,source:source.name,
    count:(window.UW_FABRIC_CATALOG.fabrics||[]).filter(f=>f.sourceId===id).length,
  }));
}
function openSupplierFabrics(name){
  state.docFilters=state.docFilters||{};state.docFilters.fabrics={q:'',appliedQ:'',category:name,status:''};go('fabrics');
}
function vSuppliers(c){
  const coverage=supplierFabricCoverage(),stock=DB.stock||[],low=stock.filter(stockNeedsReorder);
  c.innerHTML=`<div class="cards"><div class="card"><div class="lbl">Supplier directory</div><div class="val gold">${(DB.suppliers||[]).length}</div></div><div class="card"><div class="lbl">Fabric price-list providers</div><div class="val gold">${coverage.length}</div><div class="sub">${coverage.reduce((sum,s)=>sum+s.count,0)} selectable source entries</div></div><div class="card"><div class="lbl">Stock / material records</div><div class="val">${stock.length}</div></div><div class="card"><div class="lbl">At or below reorder level</div><div class="val amber">${low.length}</div></div></div>
    <div class="panel"><h3>Fabric suppliers · supplied price lists</h3><p>Supplier catalogue prices are available on quotes and invoices. Price-list entries do not represent stock held in the workshop.</p><table><tr><th>Supplier</th><th>List date</th><th>Source entries</th><th>Source document</th><th></th></tr>${coverage.map(s=>`<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.date)}</td><td>${s.count}</td><td style="white-space:normal">${escapeHtml(s.source)}</td><td><button class="btn sm" onclick="openSupplierFabrics(${escapeHtml(JSON.stringify(s.name))})">Browse fabrics</button></td></tr>`).join('')}</table></div>
    <div class="grid2"><div class="panel"><h3>Supplier Directory</h3><table><tr><th>Supplier</th><th>Category</th><th>Source files</th><th>Status</th></tr>${(DB.suppliers||[]).map(s=>`<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.category||'')}</td><td>${s.items??''}</td><td>${statusBadge(s.status)}</td></tr>`).join('')}</table></div><div class="panel"><h3>Stock & Material Sources</h3><p style="color:var(--muted)">Saved workshop quantities are retained. Confirm physical stock before changing them; importing a supplier price list does not create inventory.</p><table><tr><th>Item</th><th>Supplier</th><th>Unit</th><th>Qty</th><th>Reorder</th></tr>${stock.map((s,i)=>`<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.supplier||'')}</td><td>${escapeHtml(s.unit||'')}</td><td>${isStockReference(s)?'Catalogue reference':`<input aria-label="Stock quantity for ${escapeHtml(s.name)}" style="width:75px" type="number" min="0" step="0.01" value="${s.quantity??''}" onchange="setStockQuantity(${i},this)">`}</td><td>${isStockReference(s)?'—':s.reorderLevel??'—'}</td></tr>`).join('')||'<tr><td colspan="5">No workshop stock records are saved.</td></tr>'}</table></div></div>`;
}
function setStockQuantity(index,input){
  const quantity=Number(input.value);if(input.value===''||!Number.isFinite(quantity)||quantity<0){toast('Enter a confirmed non-negative stock quantity');input.value=DB.stock[index].quantity??'';return;}
  DB.stock[index].quantity=quantity;save();render();
}
