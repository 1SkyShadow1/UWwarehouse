const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const repo=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(repo,'public/index.html'),'utf8');
const moduleCode=fs.readFileSync(path.join(repo,'public/js/shared-sync.js'),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
function client(data,fetcher){
  const cache=new Map(),timers=new Set();
  const context=vm.createContext({DB:copy(data),DB_KEY:'test',fetch:fetcher,nativeFetch:fetcher,
    localStorage:{getItem:key=>cache.get(key),setItem:(key,value)=>cache.set(key,value),removeItem:key=>cache.delete(key)},
    sessionStorage:{setItem:()=>{}},document:{getElementById:()=>null,querySelector:()=>null},
    mergeBundledFnbState:()=>{},normalizeWageLedger:()=>{},deduplicateExpenseLedger:()=>{},normalizePayables:()=>{},render:()=>{},toast:()=>{},console,
    setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timers.add(timer);return timer;},clearTimeout,
  });
  vm.runInContext(moduleCode+'\n'+html.slice(html.indexOf('let serverRevision = null;'),html.indexOf('async function resolveStateConflict(choice){')),context);
  context.synchronizeRemoteDocuments=async()=>{};
  return {context,cache,stop:()=>timers.forEach(clearTimeout)};
}
test('independent changes merge; overlapping edits and edit/delete races require review',()=>{
  const c=client({},async()=>{}).context;
  const base={meta:{localSavedAt:'old'},invoices:[{id:'one',customer:'Client',paid:0}],quotes:[]};
  const local=copy(base),remote=copy(base);
  local.invoices.push({id:'brian',customer:'Brian customer'});remote.invoices.push({id:'evans',customer:'Evans customer'});
  local.meta.localSavedAt='local';remote.meta.localSavedAt='remote';
  const merged=c.mergeSharedState(base,local,remote);
  assert.equal(merged.conflicts.length,0);assert.deepEqual(copy(merged.data.invoices.map(i=>i.id)).sort(),['brian','evans','one']);
  local.invoices[0].paid=10;remote.invoices[0].paid=20;
  assert.deepEqual(copy(c.mergeSharedState(base,local,remote).conflicts),['invoices[one].paid']);
  remote.invoices.shift();assert(c.mergeSharedState(base,local,remote).conflicts.length);
  assert.equal(base.invoices[0].paid,0);
  const stock={stock:[{sku:'one',quantity:1},{sku:'two',quantity:2}]},stockLocal=copy(stock),stockRemote=copy(stock);
  stockLocal.stock[0].quantity=3;stockRemote.stock[1].quantity=4;
  assert.deepEqual(copy(c.mergeSharedState(stock,stockLocal,stockRemote).data.stock),[{sku:'one',quantity:3},{sku:'two',quantity:4}]);
});
test('preserved conflicts resume independent changes and retain contested versions on disk',async()=>{
  const base={meta:{},invoices:[{id:'one',paid:0}],quotes:[],expenses:[],scannedDocuments:[]};
  const local=copy(base),remote=copy(base);local.invoices[0].paid=10;remote.invoices[0].paid=20;
  local.scannedDocuments.push({id:'scan-new',name:'Receipt'});remote.quotes.push({id:'shared-quote'});
  const c=client(local,async()=>{});let preserved;
  c.context.preserveConflictOnDisk=async value=>{preserved=copy(value);};c.context.clearConflictRecovery=()=>{};
  vm.runInContext('serverConflict={local:DB,base:'+JSON.stringify(base)+',remote:'+JSON.stringify(remote)+',revision:1};',c.context);
  try{
    assert.equal(await c.context.resumePreservedSharedChanges({revision:2,data:remote}),true);
    assert.equal(preserved.local.invoices[0].paid,10);
    assert.equal(c.context.DB.invoices[0].paid,20);
    assert.equal(c.context.DB.scannedDocuments[0].id,'scan-new');
    assert.equal(c.context.DB.quotes[0].id,'shared-quote');
    assert.equal(vm.runInContext('serverConflict',c.context),null);
    assert.equal(vm.runInContext('serverSyncAvailable',c.context),true);
  }finally{c.stop();}
});

test('startup reads the shared copy instead of overwriting it from a newer browser timestamp',async()=>{
  const remote={revision:7,data:{meta:{},invoices:[{id:'Brian invoice'}],quotes:[],expenses:[]}},methods=[];
  const c=client({meta:{localSavedAt:'2099-01-01'},invoices:[],quotes:[],expenses:[]},async(_,options={})=>{
    methods.push(options.method||'GET');return {ok:true,status:200,json:async()=>copy(remote)};
  });
  try{assert.equal(await c.context.initializeServerSync(),true);assert.equal(c.context.DB.invoices[0].id,'Brian invoice');assert.deepEqual(methods,['GET']);}
  finally{c.stop();}
});
test('poll refreshes other-profile changes without writes and preserves open forms',async()=>{
  let calls=0;const remote={revision:2,data:{meta:{},invoices:[{id:'Evans invoice'}],quotes:[],expenses:[]}};
  const c=client({meta:{},invoices:[],quotes:[],expenses:[]},async()=>{calls++;return {ok:true,status:200,json:async()=>copy(remote)};});
  try{
    vm.runInContext('serverSyncAvailable=true;serverRevision=1;',c.context);
    c.context.document.querySelector=()=>({});await c.context.refreshSharedWorkspace();assert.equal(calls,0);
    c.context.document.querySelector=()=>null;await c.context.refreshSharedWorkspace();assert.equal(c.context.DB.invoices[0].id,'Evans invoice');assert.equal(calls,1);
  }finally{c.stop();}
});
test('pending offline changes are preserved for review when another profile has advanced the revision',async()=>{
  const local={meta:{syncPending:true,syncRevision:1},invoices:[{id:'Offline draft'}],quotes:[],expenses:[]};
  const remote={revision:2,data:{meta:{},invoices:[{id:'Other profile'}],quotes:[],expenses:[]}};
  const c=client(local,async()=>({ok:true,status:200,json:async()=>copy(remote)}));
  try{
    await c.context.initializeServerSync();
    assert.equal(c.context.DB.invoices[0].id,'Offline draft');
    const conflict=copy(vm.runInContext('serverConflict',c.context));
    assert.equal(conflict.local.invoices[0].id,'Offline draft');assert.equal(conflict.remote.invoices[0].id,'Other profile');
    assert.equal(await c.context.syncServerState(true,true),false);
  }finally{c.stop();}
});
test('two authenticated profiles share changes, merge simultaneous records, and reject racing stale writes',async()=>{
  const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'uw-profile-sync-'));
  const port=51000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`;
  const password='Disposable-test-password',salt=crypto.randomBytes(16).toString('hex');
  const hash=`scrypt$16384$8$1$${salt}$${crypto.scryptSync(password,salt,64,{N:16384,r:8,p:1}).toString('hex')}`;
  const users={brian:{name:'Brian',role:'Owner',passwordHash:hash},evans:{name:'Evans',role:'Manager',passwordHash:hash}};
  const recoveredId='a'.repeat(32);
  fs.mkdirSync(path.join(dataRoot,'documents'));
  fs.writeFileSync(path.join(dataRoot,'documents',recoveredId+'.bin'),'%PDF-1.4\npreviously orphaned receipt');
  const initial={meta:{},invoices:[],quotes:[],expenses:[],receipts:[],documents:[{id:recoveredId,name:'Scanned_20261007-0956.pdf',createdAt:'2026-10-07T08:00:00Z',url:'/api/documents/'+recoveredId,mimeType:'application/pdf'}]};
  fs.writeFileSync(path.join(dataRoot,'uw-state.json'),JSON.stringify({version:1,revision:1,updatedAt:new Date().toISOString(),data:initial}));
  const server=spawn(process.execPath,[path.join(repo,'server.js')],{env:{...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(port),UW_DATA_DIR:dataRoot,UW_DOCUMENTS_DIR:path.join(dataRoot,'documents'),UW_INVOICES_DIR:path.join(dataRoot,'invoices'),UW_QUOTES_DIR:path.join(dataRoot,'quotes'),UW_AUTH_USERS_JSON:JSON.stringify(users),UW_API_KEY:'',SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:''},stdio:'ignore'});
  const clients=[];
  try{
    const deadline=Date.now()+60000;
    while(true){try{if((await fetch(base+'/api/health')).ok)break;}catch{}if(Date.now()>deadline)throw Error('Test server did not start');await new Promise(r=>setTimeout(r,100));}
    async function login(email){
      const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(response.status,200);
      const session=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
      return (url,options={})=>fetch(base+url,{...options,headers:{...options.headers,Cookie:cookie,'x-csrf-token':session.csrfToken}});
    }
    const brianFetch=await login('brian'),evansFetch=await login('evans');
    const eventAbort=new AbortController();
    const events=await brianFetch('/api/state/events',{signal:eventAbort.signal});
    assert.equal(events.status,200);assert.match(events.headers.get('content-type'),/text\/event-stream/);
    const reader=events.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/event: revision/);
    const upload=async(fetcher,name)=>{
      const form=new FormData();form.append('file',new Blob(['%PDF-1.4\nreceipt'],{type:'application/pdf'}),name);form.append('kind','scan');
      const result=await fetcher('/api/documents',{method:'POST',body:form});assert.equal(result.status,201);return result.json();
    };
    const uploads=await Promise.all([upload(brianFetch,'Brian receipt.pdf'),upload(evansFetch,'Evans receipt.pdf')]);
    assert.match(new TextDecoder().decode((await reader.read()).value),/event: revision/);
    eventAbort.abort();await reader.cancel().catch(()=>{});
    const uploadedSnapshot=await (await evansFetch('/api/state')).json();
    assert.equal(uploadedSnapshot.data.scannedDocuments.length,3);
    assert(uploadedSnapshot.data.scannedDocuments.some(scan=>scan.id===recoveredId));
    assert(uploads.every(doc=>uploadedSnapshot.data.scannedDocuments.some(scan=>scan.id===doc.id&&scan.contentHash.length===64)));

    assert.equal((await fetch(base+'/api/state')).status,401);
    const brian=client(initial,brianFetch),evans=client(initial,evansFetch);clients.push(brian,evans);
    await brian.context.initializeServerSync();await evans.context.initializeServerSync();
    brian.context.DB.invoices.push({id:'BRIAN-1',customer:'Brian test',date:'2026-10-05',items:[{desc:'Fabric',qty:2,price:102}]});
    await brian.context.syncServerState(true,true);await evans.context.refreshSharedWorkspace();
    assert.equal(evans.context.DB.invoices[0].id,'BRIAN-1');
    evans.context.DB.invoices[0].paid=50;evans.context.queueServerStateSave();
    await evans.context.syncServerState(true,true);await brian.context.refreshSharedWorkspace();
    assert.equal(brian.context.DB.invoices[0].paid,50);
    evans.context.DB.scannedDocuments.find(scan=>scan.id===uploads[0].id).aiReview={provider:'gemini',successful:true,merchant:'Fixture merchant',amount:12};
    evans.context.DB.stock=[{sku:'SHARED-STOCK',quantity:3}];evans.context.DB.suppliers=[{id:'SHARED-SUPPLIER',name:'Fixture supplier'}];
    evans.context.queueServerStateSave();await evans.context.syncServerState(true,true);await brian.context.refreshSharedWorkspace();
    assert.equal(brian.context.DB.scannedDocuments.find(scan=>scan.id===uploads[0].id).aiReview.amount,12);
    assert.equal(brian.context.DB.stock[0].quantity,3);assert.equal(brian.context.DB.suppliers[0].id,'SHARED-SUPPLIER');

    brian.context.DB.quotes.push({id:'BRIAN-Q',customer:'Brian test',items:[{desc:'Work',qty:1,price:10}]});
    evans.context.DB.invoices.push({id:'EVANS-1',customer:'Evans test',items:[{desc:'Work',qty:1,price:20}]});
    brian.context.queueServerStateSave();evans.context.queueServerStateSave();
    await Promise.all([brian.context.syncServerState(true,true),evans.context.syncServerState(true,true)]);
    await brian.context.syncServerState(true,true);await evans.context.syncServerState(true,true);
    // A stale request can merge once, so wait for the scheduled retry to settle.
    await new Promise(r=>setTimeout(r,150));
    const snapshot=await (await brianFetch('/api/state')).json();
    assert.deepEqual(snapshot.data.invoices.map(i=>i.id).sort(),['BRIAN-1','EVANS-1']);assert.equal(snapshot.data.quotes[0].id,'BRIAN-Q');
    const unchanged=await evansFetch('/api/state?revision='+snapshot.revision);assert.equal(unchanged.status,204);
    const writes=await Promise.all([brianFetch,evansFetch].map(fetcher=>fetcher('/api/state',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision:snapshot.revision,data:snapshot.data})})));
    assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);
    const latest=await (await brianFetch('/api/state')).json();await evans.context.initializeServerSync();
    assert.deepEqual(evans.context.DB.invoices.map(i=>i.id).sort(),latest.data.invoices.map(i=>i.id).sort());
  }finally{clients.forEach(c=>c.stop());server.kill();}
});
