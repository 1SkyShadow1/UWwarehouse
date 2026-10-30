const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const root=path.join(__dirname,'..','public');
const savedPresets=Object.fromEntries(Array.from({length:4},(_,index)=>[`TEST-SAVED-${index+1}`,{id:`TEST-SAVED-${index+1}`,code:`TEST-SAVED-${index+1}`,item:'Labour',desc:`Saved labour ${index+1}`,qty:1,price:100,savedPreset:true}]));
const priceBook=Array.from({length:110},(_,index)=>index===0?{code:'QA',desc:'Wingback chair',mtr:3,fabCost:110,matCost:420,labHr:2}:{code:`TEST-${index}`,desc:`Test item ${index}`,mtr:1,fabCost:10,matCost:20,labHr:1});
const context=vm.createContext({window:{},DB:{priceBook,meta:{savedItemPresets:savedPresets}},escapeHtml:v=>String(v),R:v=>'R '+v});
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
test('quote complete-item presets apply on selection and label each added component with the product',()=>{
  const preset={code:'STD-COU-1',desc:'One Seater Couch - Standard',mtr:7,fabCost:120,matCost:150,labHr:4};
  context.DB.priceBook.push(preset);
  const existing={descriptionField:{value:'Existing work line'},querySelector:()=>null},added={descriptionField:{value:'Fabric - Sage'},querySelector:selector=>selector==='.i-desc'?added.descriptionField:null},rows=[existing];
  const table={querySelectorAll:()=>rows};
  context.document={getElementById:id=>id==='f-items'?table:id==='f-qty'?{value:'2'}:null};
  context.applyQuotePreset=()=>rows.push(added);
  context.appendDocumentItem=(tableId,prefix,item)=>{
    const fields={'.i-desc':{value:item.desc},'.i-item':{value:item.item},'.i-qty':{value:String(item.qty)}};
    rows.push({querySelector:selector=>fields[selector]||null});
  };
  context.updateLinePricing=row=>{row.pricingUpdated=true;};
  const index=context.quotePresets().indexOf(preset);
  context.applyQuotePresetForQuote(String(index),'f-items','i','f');
  assert.equal(existing.descriptionField.value,'Existing work line','Existing quote lines must be retained unchanged');
  assert.equal(added.descriptionField.value,'2 x One Seater Couch - Standard - Fabric - Sage');
  assert.equal(added._lineItem.quoteProductPrefix,true,'Preset-generated quote components must retain their product identity when collected');
  assert.equal(added.pricingUpdated,true,'Changed line descriptions should refresh their calculated display');
  assert.equal(rows[2].querySelector('.i-desc').value,'2 x One Seater Couch - Standard - Foam');
  assert.equal(rows[2].querySelector('.i-qty').value,'2');
  assert.equal(rows[2].querySelector('.i-item').value,'Foam');
  assert.equal(context.quotePresetProductDescription({desc:'1 x One Seater Couch'},'Foam',1),'1 x One Seater Couch - Foam');
});
test('complete-item presets label every new component when replacing the blank starter row',()=>{
  const preset={code:'STD-COU-1',desc:'One Seater Couch - Standard',mtr:7,fabCost:120,matCost:150,labHr:4};
  context.DB.priceBook.push(preset);
  const header={},blankRow={querySelector:selector=>selector==='.i-desc'?{value:''}:null},rows=[header,blankRow],table={querySelectorAll:()=>rows};
  context.document={getElementById:id=>id==='blank-items'?table:id==='f-qty'?{value:'2'}:null};
  context.applyQuotePreset=value=>{
    rows.splice(1,1);
    for(const line of context.quotePresetLines(context.quotePresets()[Number(value)],2)){
      const fields={'.i-desc':{value:line.desc},'.i-item':{value:line.item},'.i-qty':{value:String(line.qty)}};
      rows.push({querySelector:selector=>fields[selector]||null});
    }
  };
  context.appendDocumentItem=(tableId,prefix,line)=>{
    const fields={'.i-desc':{value:line.desc},'.i-item':{value:line.item},'.i-qty':{value:String(line.qty)}};
    rows.push({querySelector:selector=>fields[selector]||null});
  };
  context.updateLinePricing=()=>{};
  context.applyQuotePresetForQuote(String(context.quotePresets().indexOf(preset)),'blank-items','i','f');
  const descriptions=rows.slice(1).map(row=>row.querySelector('.i-desc').value);
  assert.deepEqual(descriptions,[
    '2 x One Seater Couch - Standard - Fabric',
    '2 x One Seater Couch - Standard - Consumables - Materials allowance',
    '2 x One Seater Couch - Standard - Labour - Upholster',
    '2 x One Seater Couch - Standard - Foam',
  ]);
});
test('quote preset notes describe the selected work and fabric correctly',()=>{
  const preset={desc:'Two Seater Couch - Sleeper'};
  assert.equal(context.quotePresetJobDescription(preset,1,'Reupholster',4,'Hemingway (Shadow)'),'1 x Two Seater Couch - Sleeper to be reupholstered in 4m Hemingway (Shadow) fabric.');
  assert.equal(context.quotePresetJobDescription(preset,2,'Repair'),'2 x Two Seater Couch - Sleeper to be repaired.');
  assert.equal(context.quotePresetJobDescription(preset,1,'Manufacturing',2.5,'Bahamas (PL13)'),'1 x Two Seater Couch - Sleeper to be made in 2.5m Bahamas (PL13) fabric.');
});
test('quote forms auto-add every preset while invoice forms keep the explicit add action',()=>{
  const quotePicker=context.quotePresetPickerHtml('f-items','i','f',true);
  assert.match(quotePicker,/onchange="previewQuotePreset\(\);applyQuotePresetForQuote\(this\.value,'f-items','i','f'\)"/);
  assert.match(quotePicker,/data-auto-apply="true"/);
  assert.match(quotePicker,/<button id="preset-add"[^>]*hidden/);
  assert.match(quotePicker,/onclick="applyQuotePresetForQuote/);
  const invoicePicker=context.quotePresetPickerHtml('ef-items','ei','ef');
  assert.match(invoicePicker,/onchange="previewQuotePreset\(\)"/);
  assert.match(invoicePicker,/onclick="applyQuotePreset\(document\.getElementById/);
  const editedQuotePicker=context.quotePresetPickerHtml('eq-items','eq','eq');
  assert.match(editedQuotePicker,/applyQuotePresetForQuote\(this\.value,'eq-items','eq','eq'\)/);
  const editor=fs.readFileSync(path.join(root,'js/document-editor.js'),'utf8');
  assert.match(editor,/quotePresetPickerHtml\('f-items','i','f',mode==='quote'\)/);
});
test('every available preset auto-adds its lines to a quote while preserving existing rows',()=>{
  const presets=context.quotePresets();
  assert(presets.length>=541,`Expected at least 541 available presets; found ${presets.length}`);
  assert.equal(110+context.window.UW_ITEM_PRESETS.presets.length+context.archiveJobPresets().length+4,541);
  let rows=[];
  const table={querySelectorAll:()=>rows};
  const existing={querySelector:()=>null};
  context.document={getElementById:id=>id==='all-presets-items'?table:id==='f-qty'?{value:'1'}:null};
  context.appendDocumentItem=(tableId,prefix,item)=>{
    const fields={'.t-desc':{value:item.desc},'.t-item':{value:item.item},'.t-qty':{value:String(item.qty)}};
    rows.push({querySelector:selector=>fields[selector]||null});
  };
  context.applyQuotePreset=value=>{
    for(const line of context.quotePresetLines(presets[Number(value)],1))context.appendDocumentItem('all-presets-items','t',line);
  };
  context.updateLinePricing=()=>{};
  let addedLines=0;
  for(let index=0;index<presets.length;index++){
    const preset=presets[index];
    rows=[existing];
    context.applyQuotePresetForQuote(String(index),'all-presets-items','t','f');
    let expected=context.quotePresetLines(preset,1).length;
    if(!preset.item&&!preset.savedPreset&&!preset.lines&&preset.matCost!=null&&!context.quotePresetLines(preset,1).some(line=>line.item==='Foam'))expected++;
    assert.equal(rows.length,expected+1,`Preset ${index} (${preset.desc}) should add every generated line`);
    assert.equal(rows[0],existing,'Existing quote lines must not be removed');
    if(!preset.item&&!preset.savedPreset){
      const title=String(preset.desc||'').trim().replace(/^\d+(?:\.\d+)?\s*[x×]\s*/i,'');
      for(const row of rows.slice(1)){
        const description=row.querySelector('.t-desc')?.value||'';
        assert(description.includes(title),`Preset ${index} (${preset.desc}) should label each generated line with its product`);
      }
    }
    addedLines+=expected;
  }
  assert(addedLines>=presets.length,'Every preset must add at least one quote line');
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
