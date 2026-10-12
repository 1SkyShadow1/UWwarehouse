const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const root=path.join(__dirname,'..','public');
const context=vm.createContext({window:{},DB:{priceBook:[{code:'QA',desc:'Wingback chair',mtr:3,fabCost:110,matCost:420,labHr:2}]},escapeHtml:v=>String(v),R:v=>'R '+v});
for(const file of ['item-presets.js','js/document-format.js','js/item-presets.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
test('archive presets retain historical rates without exposing client metadata',()=>{
  const presets=context.window.UW_ITEM_PRESETS.presets;
  assert(presets.length>=334);assert.equal(context.window.UW_ITEM_PRESETS.archiveFiles,3401);
  assert.equal(new Set(presets.map(p=>p.id)).size,presets.length);
  for(const p of presets){
    assert(!p.customer&&!p.contact&&!p.path&&!p.email);
    assert(p.price==null||Number.isFinite(p.price)&&p.price>0);
    assert(['Fabric','Foam','Labour','Consumables','Delivery','Other'].includes(p.item));
  }
  assert(presets.some(p=>p.desc==='Fabric - Prasa'&&p.price===351));
  assert(presets.some(p=>p.desc==='Consumables - Glue'&&p.price===143));
  assert(!presets.some(p=>/coke|lemonade|veggies|calamari/i.test(p.desc)));
});
test('uncoded custom lines become reusable presets, retaining prices and avoiding duplicate codes',()=>{
 const items=[{item:'Labour',desc:'Labour - Repair timber frame',qty:5,price:130,unitCost:100,markupPercent:30,pricingMode:'markup',customer:'Private customer'}];
 context.registerDocumentItemPresets(items);
 const code=items[0].code;assert.equal(code,'LAB-FRA-1');
 const saved=context.savedLinePresets().find(p=>p.code===code);
 assert.equal(saved.qty,1);assert.equal(saved.price,130);assert.equal(saved.unitCost,100);assert(!saved.customer);
 const copy={...items[0],code:'',qty:20};context.registerDocumentItemPresets([copy]);assert.equal(copy.code,code);
 const changed={...copy,code:'',price:195};context.registerDocumentItemPresets([changed]);assert.notEqual(changed.code,code);
 assert.equal(changed.code,'LAB-FRA-2');
 assert.equal(context.itemCodeStem({item:'Other',desc:'Three seater recliner couch'}),'REC-COU');
 assert.equal(context.itemCodeStem({item:'Other',desc:'Wingback chair'}),'WIN-CHR');
 assert.equal(context.itemCodeStem({item:'Consumables',desc:'Consumables - Glue'}),'CON-GLU');
 const preset=context.quotePresets().find(p=>p.code===code),line=context.quotePresetLines(preset,2)[0];
 assert.equal(line.qty,2);assert.equal(line.price,130);assert.equal(line.unitCost,100);assert.equal(line.markupPercent,30);assert.equal(line.historicalPricing,false);
 const coded={item:'Foam',desc:'Foam',qty:1,price:20,code:'SUPPLIER-123'};context.registerDocumentItemPresets([coded]);assert.equal(coded.code,'SUPPLIER-123');
});
test('independent profile presets merge through the existing shared metadata object',()=>{
 const c=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(root,'js/shared-sync.js'),'utf8'),c);
 const result=c.mergeSharedState({meta:{}},{meta:{savedItemPresets:{A:{id:'A'}}}},{meta:{savedItemPresets:{B:{id:'B'}}}});
 assert.equal(result.conflicts.length,0);assert.equal(Object.keys(result.data.meta.savedItemPresets).length,2);
});
test('complete item presets print category descriptions and leave purchase costs unknown',()=>{
  const lines=context.quotePresetLines(context.DB.priceBook[0],2,3,'Sage');
  assert.equal(lines.length,3);assert.equal(lines[0].qty,6);assert.equal(lines[0].desc,'Fabric - Sage');
  assert(lines.every(p=>p.unitCost===null&&p.pricingMode==='manual'));
  assert(lines.every(p=>!p.desc.includes('Wingback')));
  assert(!lines.some(p=>p.item==='Consumables'&&p.price===20));
});
test('historical lines preserve unit rates; descriptions without a price require entry',()=>{
  const preset=context.quotePresets().find(p=>p.desc==='Consumables - Glue');
  const line=context.quotePresetLines(preset,4)[0];assert.equal(line.qty,4);assert.equal(line.price,143);assert.equal(line.unitCost,null);
  const unknown=context.quotePresetLines({lines:[{item:'Consumables',desc:'Thread',price:null,qty:1}]})[0];
  assert.equal(unknown.price,'');assert.equal(unknown.unitCost,null);
  const incomplete=context.quotePresetLines({desc:'Unpriced chair'});
  assert(incomplete.every(line=>line.price===''));
  assert.equal(incomplete[0].qty,'','Missing material measurements must not become one metre');
});
test('colour choices accept free text and cover a broad palette',()=>{
  const html=context.fabricColourOptions();assert((html.match(/<option /g)||[]).length>=70);
  for(const colour of ['Sage','Terracotta','Burgundy','Navy','Black','Ivory'])assert(html.includes(colour));
});
test('previous job bundles keep source quantities and do not change unit rates when repeated',()=>{
  const bundle={originalJobQuantities:true,lines:[{item:'Fabric',desc:'Fabric - Stone',qty:18,price:195.5},{item:'Labour',desc:'Labour',qty:6,price:410}]};
  const lines=context.quotePresetLines(bundle,2);
  assert.equal(lines[0].qty,36);assert.equal(lines[0].price,195.5);
  assert.equal(lines[1].qty,12);assert.equal(lines[1].price,410);
  assert(lines.every(p=>p.unitCost===null));
  for(const p of context.archiveJobPresets())assert.equal(Math.round(p.lines.reduce((s,l)=>s+l.qty*l.price,0)*100)/100,p.total);
  const prasa=context.archiveJobPresets().find(p=>p.desc==='Prasa Train Seats');
  assert(prasa);assert.equal(prasa.lines.length,11);assert.equal(prasa.total,173376);
});
