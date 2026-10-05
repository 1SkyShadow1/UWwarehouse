// Three-way merging keeps independent profile edits without guessing which
// version of an overlapping financial edit should win.
function syncComparable(value){
  const copy=JSON.parse(JSON.stringify(value||{}));
  if(copy.meta)for(const key of ['localSavedAt','syncPending','syncRevision'])delete copy.meta[key];
  return copy;
}
function mergeSharedState(base,local,remote){
  const conflicts=[],equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const key=row=>String(row.id??row.sku);
  const keyed=v=>Array.isArray(v)&&v.every(row=>object(row)&&(row.id!=null||row.sku!=null))&&new Set(v.map(key)).size===v.length;
  function merge(b,l,r,path){
    if(equal(l,b))return r;
    if(equal(r,b)||equal(l,r))return l;
    if(object(b)&&object(l)&&object(r)){
      const result={};
      for(const key of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){
        const value=merge(b[key],l[key],r[key],path?path+'.'+key:key);
        if(value!==undefined)result[key]=value;
      }
      return result;
    }
    if(keyed(b)&&keyed(l)&&keyed(r)){
      const maps=[b,l,r].map(rows=>new Map(rows.map(row=>[key(row),row]))),result=[];
      for(const id of new Set([...r.map(key),...l.map(key),...b.map(key)])){
        const value=merge(maps[0].get(id),maps[1].get(id),maps[2].get(id),path+'['+id+']');
        if(value!==undefined)result.push(value);
      }
      return result;
    }
    conflicts.push(path);return l;
  }
  return {data:merge(syncComparable(base),syncComparable(local),syncComparable(remote),''),conflicts};
}
let sharedSyncBase=null;
function sharedSyncStatus(message){
  const label=document.getElementById('workspace-sync-label');if(label)label.textContent=message;
}
function hasSharedAccounting(data){return Array.isArray(data?.invoices)||Array.isArray(data?.quotes)||Array.isArray(data?.expenses);}
function preserveSharedConflict(snapshot,paths=[]){
  serverConflict={local:JSON.parse(JSON.stringify(DB)),remote:snapshot.data||{},revision:snapshot.revision,paths};
  try{localStorage.setItem('UW_STATE_CONFLICT',JSON.stringify(serverConflict));}
  catch(error){console.warn('Conflict remains in memory; current local copy is retained.',error);}
  serverSyncAvailable=false;serverSyncPending=false;
  sharedSyncStatus('Shared edit conflict · review Settings');
}
function applySharedSnapshot(snapshot){
  DB={...DB,...snapshot.data,meta:{...DB.meta,...snapshot.data?.meta,syncPending:false,syncRevision:snapshot.revision}};
  sharedSyncBase=JSON.parse(JSON.stringify(DB));serverRevision=Number(snapshot.revision||0);
  mergeBundledFnbState(DB);normalizeWageLedger(DB);deduplicateExpenseLedger(DB);normalizePayables(DB);
  writeLocalSnapshot(JSON.stringify(DB));render();sharedSyncStatus('Shared workspace up to date');
}
async function refreshSharedWorkspace(){
  if(serverSyncInFlight||serverSyncPending||serverConflict)return;
  if(!serverSyncAvailable)return initializeServerSync();
  // Keep an open form intact. The next poll after closing it loads new records.
  if(document.querySelector('#modal-root input,#modal-root textarea,#modal-root select'))return;
  serverSyncInFlight=true;
  try{
    const response=await fetch('/api/state?revision='+serverRevision,{cache:'no-store',credentials:'include',headers:{Accept:'application/json'}});
    if(response.status===204)return;
    if(!response.ok)throw await stateRequestError(response,'Shared workspace refresh failed');
    const snapshot=await response.json();
    if(!serverSyncPending&&!DB.meta?.syncPending&&!document.querySelector('#modal-root input,#modal-root textarea,#modal-root select')){
      const before=JSON.stringify(syncComparable(snapshot.data));applySharedSnapshot(snapshot);
      if(JSON.stringify(syncComparable(DB))!==before)queueServerStateSave();
    }
  }catch(error){serverSyncAvailable=false;serverSyncError=error;sharedSyncStatus('Offline · changes pending sync');}
  finally{serverSyncInFlight=false;if(serverSyncPending&&serverSyncAvailable)queueServerStateSave();}
}
