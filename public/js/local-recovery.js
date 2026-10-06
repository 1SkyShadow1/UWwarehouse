// Browser recovery is a cache. The authenticated local server owns the ledger.
let recoveryDatabasePromise,recoveryWrite=Promise.resolve(),browserRecoveryChecked=false;
function recoveryDatabase(){
  if(typeof indexedDB==='undefined')return Promise.resolve(null);
  if(!recoveryDatabasePromise)recoveryDatabasePromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open('UW_LOCAL_RECOVERY',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('snapshots');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  return recoveryDatabasePromise;
}
async function browserRecoveryRead(key){
  const database=await recoveryDatabase();if(!database)return null;
  return new Promise((resolve,reject)=>{const request=database.transaction('snapshots').objectStore('snapshots').get(key);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);});
}
function browserRecoveryWrite(key,value){
  const operation=recoveryWrite.catch(()=>{}).then(async()=>{
    const database=await recoveryDatabase();if(!database)throw new Error('Browser recovery is unavailable');
    await new Promise((resolve,reject)=>{const transaction=database.transaction('snapshots','readwrite');transaction.objectStore('snapshots').put(value,key);transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});
  });
  recoveryWrite=operation;return operation;
}
async function restoreBrowserRecovery(){
  if(browserRecoveryChecked)return;browserRecoveryChecked=true;
  try{
    const serialized=await browserRecoveryRead('pending-workspace');
    if(serialized){const cached=JSON.parse(serialized);if(Date.parse(cached.meta?.localSavedAt||'')>Date.parse(DB.meta?.localSavedAt||'1970-01-01'))DB={...DB,...cached,meta:{...DB.meta,...cached.meta}};}
    const conflict=await browserRecoveryRead('conflict');if(conflict&&!serverConflict)serverConflict=JSON.parse(conflict);
  }catch(error){console.warn('Browser recovery could not be loaded; the local server remains authoritative.',error);}
  if(!serverConflict){
    const id=localStorage.getItem('UW_CONFLICT_ID');
    if(/^[a-f0-9]{32}$/.test(id||''))try{
      const response=await fetch('/api/state/conflicts/'+id);
      if(response.ok)serverConflict=await response.json();
    }catch{}
  }
}
async function preserveConflictOnDisk(conflict){
  const response=await fetch('/api/state/conflicts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(conflict)});
  if(!response.ok)throw await stateRequestError(response,'Local recovery backup failed');
  const result=await response.json();
  try{localStorage.removeItem('UW_STATE_CONFLICT');localStorage.setItem('UW_CONFLICT_ID',result.id);}catch{}
  return result;
}
function cacheConflictRecovery(conflict){
  const serialized=JSON.stringify(conflict);
  browserRecoveryWrite('conflict',serialized).catch(()=>{});
  preserveConflictOnDisk(conflict).catch(error=>sharedSyncStatus('Conflict retained · local backup pending'));
}
function clearConflictRecovery(){
  localStorage.removeItem('UW_CONFLICT_ID');localStorage.removeItem('UW_STATE_CONFLICT');
  browserRecoveryWrite('conflict',null).catch(()=>{});
}
let localServerOnly=false;
async function loadLocalStorageMode(){
  try{
    const response=await fetch('/api/health',{cache:'no-store'});if(!response.ok)return;
    const health=await response.json();localServerOnly=Boolean(health.localOnly);
    const label=document.getElementById('storage-location-label');if(label&&health.dataDir)label.textContent='Local storage: '+health.dataDir;
  }catch{}
}
