const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const {spawn}=require('node:child_process');
const repo=path.resolve(__dirname,'..');

test('local mode stores shared state, conflict backups and encrypted persistent sessions without cloud requests',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'uw-external-local-'));
  const dataRoot=path.join(root,'external-data');fs.mkdirSync(dataRoot);
  const trap=path.join(root,'network-trap.js');
  fs.writeFileSync(trap,"global.fetch=async()=>{throw new Error('Unexpected external network request')};");
  const port=54000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`;
  const password='LocalFixture-password',salt=crypto.randomBytes(16).toString('hex');
  const hash=`scrypt$16384$8$1$${salt}$${crypto.scryptSync(password,salt,64,{N:16384,r:8,p:1}).toString('hex')}`;
  const env={...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test',UW_LOCAL_ONLY:'1',UW_DATA_DIR:dataRoot,UW_DOCUMENTS_DIR:path.join(dataRoot,'documents'),UW_INVOICES_DIR:path.join(dataRoot,'invoices'),UW_QUOTES_DIR:path.join(dataRoot,'quotes'),UW_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),UW_AUTH_USERS_JSON:JSON.stringify({brian:{name:'Brian',role:'Owner',passwordHash:hash},evans:{name:'Evans',role:'Manager',passwordHash:hash}}),UW_API_KEY:'',SUPABASE_URL:'https://invalid.example',SUPABASE_SERVICE_ROLE_KEY:'fixture-cloud-key',GOOGLE_CLIENT_ID:'fixture-google',GOOGLE_CLIENT_SECRET:'fixture-google-secret'};
  let child,output='';
  async function start(){
    child=spawn(process.execPath,['--require',trap,path.join(repo,'server.js')],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
    child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
    const deadline=Date.now()+60000;
    while(true){try{const r=await fetch(base+'/api/health');if(r.ok)return r.json();}catch{}if(child.exitCode!==null||Date.now()>deadline)throw Error(output||'Local fixture did not start');await new Promise(r=>setTimeout(r,100));}
  }
  async function stop(){if(child&&child.exitCode===null){const closed=new Promise(r=>child.once('exit',r));child.kill();await closed;}}
  try{
    const health=await start();assert.equal(health.dataDir,dataRoot);assert.equal(health.localOnly,true);assert.equal(health.supabaseConfigured,false);assert.equal(health.googleConfigured,false);
    assert.equal((await fetch(base+'/api/state')).status,401);
    async function login(email){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200);const session=await r.json();return {Cookie:r.headers.get('set-cookie').split(';')[0],'x-csrf-token':session.csrfToken,'Content-Type':'application/json'};}
    const brian=await login('brian'),evans=await login('evans');
    const initial=await (await fetch(base+'/api/state',{headers:brian})).json();
    const ledger={meta:{},invoices:[{id:'SHARED-LOCAL',items:[{desc:'Fabric',qty:144,price:351}]}],quotes:[],receipts:[],expenses:[]};
    const saved=await fetch(base+'/api/state',{method:'PUT',headers:brian,body:JSON.stringify({revision:initial.revision||0,data:ledger})});assert.equal(saved.status,200,await saved.text());
    const snapshot=await (await fetch(base+'/api/state',{headers:evans})).json();assert.equal(snapshot.data.invoices[0].id,'SHARED-LOCAL');
    const form=new FormData();form.append('file',new Blob(['%PDF-1.4\nLocal upload fixture'],{type:'application/pdf'}),'local-scan.pdf');
    const upload=await fetch(base+'/api/documents',{method:'POST',headers:{Cookie:brian.Cookie,'x-csrf-token':brian['x-csrf-token']},body:form});
    assert.equal(upload.status,201);const document=await upload.json();
    const afterUpload=await (await fetch(base+'/api/state',{headers:brian})).json();
    // The client has not refreshed its document list after the upload.
    const clientSave=await fetch(base+'/api/state',{method:'PUT',headers:brian,body:JSON.stringify({revision:afterUpload.revision,data:ledger})});assert.equal(clientSave.status,200);
    assert.equal((await fetch(base+'/api/documents/'+document.id,{headers:evans})).status,200,'A subsequent workspace save must retain upload metadata');
    const recoveredId=crypto.randomBytes(16).toString('hex');fs.writeFileSync(path.join(dataRoot,'documents',recoveredId+'.bin'),'%PDF-1.4\nRecovered old scan');
    const oldScanState=await (await fetch(base+'/api/state',{headers:brian})).json();
    oldScanState.data.scannedDocuments=[{id:recoveredId,name:'recovered.pdf',url:'/api/documents/'+recoveredId}];
    assert.equal((await fetch(base+'/api/state',{method:'PUT',headers:brian,body:JSON.stringify({revision:oldScanState.revision,data:oldScanState.data})})).status,200);
    assert.equal((await fetch(base+'/api/documents/'+recoveredId,{headers:evans})).status,200,'Older local scans can recover metadata from their scan record');
    const conflict={local:ledger,remote:{...ledger,invoices:[]},revision:snapshot.revision,paths:['invoices']};
    const backup=await fetch(base+'/api/state/conflicts',{method:'POST',headers:brian,body:JSON.stringify(conflict)});assert.equal(backup.status,201);const recovery=await backup.json();
    assert(fs.existsSync(path.join(dataRoot,'conflicts',recovery.id+'.json')));
    const retrieved=await (await fetch(base+'/api/state/conflicts/'+recovery.id,{headers:evans})).json();assert.equal(retrieved.local.invoices[0].id,'SHARED-LOCAL');
    const encrypted=fs.readFileSync(path.join(dataRoot,'operator-sessions.enc'),'utf8');assert(encrypted.startsWith('v1:'));assert(!encrypted.includes(brian['x-csrf-token'])&&!encrypted.includes('Brian'));
    await stop();await start();
    assert.equal((await fetch(base+'/api/state',{headers:evans})).status,200,'Existing session must survive a local server restart');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataRoot,'uw-state.json'),'utf8')).data.invoices[0].id,'SHARED-LOCAL');
    assert(!output.includes('Unexpected external network request'),output);
  }finally{await stop();}
});

test('service worker returns a handled local-unavailable response when fetch fails',async()=>{
  const handlers={};const context=vm.createContext({URL,Response,fetch:async()=>{throw Error('Failed to fetch');},self:{location:{origin:'http://127.0.0.1:8080'},addEventListener:(name,handler)=>handlers[name]=handler},caches:{}});
  vm.runInContext(fs.readFileSync(path.join(repo,'public/sw.js'),'utf8'),context);
  let response;handlers.fetch({request:{method:'GET',url:'http://127.0.0.1:8080/api/state'},respondWith:p=>response=p});
  const result=await response;assert.equal(result.status,503);assert.match((await result.json()).error,/local server is unavailable/);
  response=null;handlers.fetch({request:{method:'GET',url:'https://external.example/file'},respondWith:p=>response=p});assert.equal(response,null);
});

test('a full localStorage cache still queues recoverable work without creating a duplicate backup',()=>{
  const html=fs.readFileSync(path.join(repo,'public/index.html'),'utf8');const start=html.indexOf('function writeLocalSnapshot('),end=html.indexOf('\nfunction ',start+10);
  const writes=[],removed=[];const context=vm.createContext({LOCAL_BACKUP_KEY:'UW_DB_V1_BACKUP',DB_KEY:'UW_DB_V1',serverSyncAvailable:true,browserRecoveryWrite:(key,value)=>{writes.push({key,value});return Promise.resolve();},localStorage:{removeItem:k=>removed.push(k),setItem:()=>{throw new Error('QuotaExceededError');}},console,sharedSyncStatus:()=>{}});
  vm.runInContext(html.slice(start,end),context);
  assert.equal(context.writeLocalSnapshot('{"meta":{"syncPending":true}}').ok,true);assert.equal(writes[0].key,'pending-workspace');assert.deepEqual(removed,['UW_DB_V1_BACKUP']);
});
