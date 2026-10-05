const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const root=path.join(__dirname,'..','public');
let lastToast='';
const context=vm.createContext({today:()=> '2026-10-05',R:value=>'R '+Number(value).toFixed(2),toast:value=>{lastToast=value;}});
for(const name of ['pricing-core','quote-history','suppliers','dashboard'])vm.runInContext(fs.readFileSync(path.join(root,'js',name+'.js'),'utf8'),context);
const plain=value=>JSON.parse(JSON.stringify(value));

test('markup and margin are distinct, rounded, and missing costs stay unknown',()=>{
  assert.equal(context.sellingFromCost(102,25),127.5);
  const line=context.lineProfit({qty:2.5,unitCost:102,price:127.5});
  assert.deepEqual(plain(line),{sell:318.75,cost:255,profit:63.75,margin:20});
  assert.equal(context.lineProfit({qty:2,price:100}).cost,null);
  assert.equal(context.lineProfit({qty:1,price:0,unitCost:0}).margin,null);
  assert.equal(context.lineProfit({qty:1,price:80,unitCost:100}).profit,-20);
  assert.equal(context.documentProfit([{qty:2,price:100,unitCost:80},{qty:1,price:50}]).complete,false);
  assert.equal(context.documentProfit([{qty:1,price:0,unitCost:0}]).complete,true);
  assert.equal(context.moneyRound(1.005),1.01);
  assert.equal(context.documentProfit([{qty:.5,price:1.01,unitCost:1},{qty:.5,price:1.01,unitCost:1}]).sell,1.01);
});
test('quote validity handles leap days, expiry boundaries, and historical blank expiry',()=>{
  assert.equal(context.dateAfterDays('2028-02-01'), '2028-03-02');
  assert.equal(context.validQuoteExpiry('2026-10-05','2026-10-04'),false);
  assert.equal(context.validQuoteExpiry('2026-10-05','2026-02-30'),false);
  assert.equal(context.validQuoteExpiry('2026-10-05',''),true);
  assert.equal(context.quoteValidity({expiry:'2026-10-05'}),'Expires soon');
  assert.equal(context.quoteValidity({expiry:'2026-10-04'}),'Expired');
  assert.equal(context.quoteValidity({}),'No expiry set');
});
test('accepted revisions are independent copies; no-op saves do not create revisions',()=>{
  const q=context.initializeQuoteHistory({id:'Q1',customer:'Client',date:'2026-10-05',expiry:'2026-11-04',status:'Draft',items:[{desc:'Fabric',qty:2.5,price:127.5,unitCost:102}]});
  assert.equal(context.acceptQuoteVersion(q),true);
  const accepted=plain(q.acceptedVersion);
  assert.equal(context.reviseQuote(q,{items:plain(q.items)}),false);
  assert.equal(q.revision,1);
  assert.equal(context.reviseQuote(q,{items:[{...q.items[0],price:150}]}),true);
  assert.equal(q.revision,2);assert.equal(q.status,'Draft');
  assert.deepEqual(plain(q.acceptedVersion),accepted);
  assert.equal(q.revisions[0].snapshot.items[0].price,127.5);
  assert.equal(context.acceptQuoteVersion(q),true);
  assert.equal(q.revisions[0].acceptedSnapshot.items[0].price,127.5);
  assert.equal(q.acceptedVersion.snapshot.items[0].price,150);
  q.items[0].fabricSource={rate:100};
  assert.equal(q.acceptedVersion.snapshot.items[0].fabricSource,undefined);
  assert(context.quoteChanges(q.revisions[0].snapshot,q.revisions[1].snapshot)[0].includes('150'));
});
test('expired acceptance is rejected; existing accepted historical version survives revision',()=>{
  const expired={date:'2026-10-01',expiry:'2026-10-04',status:'Draft',items:[]};
  assert.equal(context.acceptQuoteVersion(expired),false);assert.equal(expired.status,'Draft');assert.match(lastToast,/expired/);
  const legacy={id:'OLD',status:'Accepted',items:[{desc:'Work',qty:1,price:10}]};
  context.reviseQuote(legacy,{customer:'Updated'});
  assert.equal(legacy.revision,2);assert.equal(legacy.acceptedVersion.snapshot.items[0].price,10);
  const accepted={id:'AGREED',customer:'Client',date:'2026-01-01',expiry:'2026-01-31',status:'Accepted',items:[{desc:'Work',qty:1,price:10}]};
  assert.equal(context.acceptQuoteVersion(accepted),true,'An already accepted quote can be invoiced after its original expiry');
});
test('daily queue distinguishes overdue from unknown due dates and excludes settled or completed records',()=>{
  const db={invoices:[
    {id:'overdue',dueDate:'2026-10-04',items:[{qty:1,price:100}],deposit:20},
    {id:'unknown',date:'2020-01-01',items:[{qty:1,price:100}]},
    {id:'paid',dueDate:'2026-10-01',items:[{qty:1,price:100}],paid:100},
    {id:'void',status:'Void',items:[{qty:1,price:100}]},
  ],quotes:[{id:'soon',expiry:'2026-10-12',status:'Sent'},{id:'expired',expiry:'2026-10-04',status:'Draft'},{id:'accepted',expiry:'2026-10-04',status:'Accepted'}],
  jobs:[{id:'waiting',stage:'Deposit received'},{id:'done',stage:'Closed',materialStatus:'waiting'}],
  stock:[{name:'Fabric',quantity:2,reorderLevel:2},{name:'Unknown',quantity:null,reorderLevel:10},{name:'Catalog',unit:'price list',quantity:0,reorderLevel:0},{name:'Blank',quantity:'',reorderLevel:10}],
  fnbStatements:[{id:'s',transactions:[{id:'review',allocationNeedsReview:true},{id:'posted',ledgerPosted:true}]}]};
  const before=JSON.stringify(db),actions=plain(context.dailyActions(db));
  assert.equal(JSON.stringify(db),before);
  assert.equal(actions.length,7);
  assert.equal(actions[0].id,'overdue');assert.match(actions[0].detail,/80.00/);
  assert.match(actions.find(a=>a.id==='unknown').title,/missing/);
  assert.deepEqual(actions.filter(a=>a.kind==='quote').map(a=>a.id).sort(),['expired','soon']);
});
test('all extracted application modules and remaining inline scripts parse',()=>{
  for(const name of fs.readdirSync(path.join(root,'js')))if(name.endsWith('.js'))new vm.Script(fs.readFileSync(path.join(root,'js',name),'utf8'),{filename:name});
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(script[1].trim())new vm.Script(script[1]);
});
