let scanCleanupReview=null;
let scanCleanupRunning=false;
const scanOperations=new Map();
function scanRunningMarkup(label){return `<span class="scan-running"><span class="scan-running-spinner" aria-hidden="true"></span>${escapeHtml(label)}</span>`;}
function updateScanRunningStatus(){
  let host=document.getElementById('scan-running-status');
  if(!host){host=document.createElement('div');host.id='scan-running-status';host.setAttribute('role','status');host.setAttribute('aria-live','polite');document.body.appendChild(host);}
  host.hidden=!scanOperations.size;
  host.innerHTML=scanOperations.size?scanRunningMarkup([...scanOperations.values()].join(' · ')):'';
  document.querySelectorAll('[data-scan-action]').forEach(button=>{button.disabled=Boolean(scanOperations.size);button.setAttribute('aria-busy',String(Boolean(scanOperations.size)));});
}
function beginScanOperation(key,label){if(scanOperations.has(key))return false;scanOperations.set(key,label);updateScanRunningStatus();return true;}
function endScanOperation(key){scanOperations.delete(key);updateScanRunningStatus();}
function updateScanOperation(key,label){if(scanOperations.has(key)){scanOperations.set(key,label);updateScanRunningStatus();}}
async function startAiDuplicateCleanup(){
  if(scanCleanupRunning||scanOperations.size){toast('A review or cleanup is already running; wait for it to finish');return;}
  const scans=(DB.scannedDocuments||[]).filter(doc=>!isLegacyBulkScan(doc)&&doc.canonical&&!doc.existingMatch);
  if(scans.length<2){toast('At least two scans are needed for a duplicate check');return;}
  if(scans.length>1000){toast('Select a smaller scan library for review; no records were removed');return;}
  if(scanCleanupReview){showDuplicateCleanupReview();return;}
  scanCleanupRunning=true;
  beginScanOperation('duplicate-check',`Running Gemini duplicate check · ${scans.length} scans`);
  modal('<h3>Gemini duplicate check</h3><p role="status">'+scanRunningMarkup('Running · comparing receipt numbers, merchants, dates and totals…')+'</p><p>No documents will be removed until you select and confirm the candidates.</p><button class="btn" onclick="closeModal()">Close</button>');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),95000);
  try{
    const response=await fetch('/api/ai/duplicate-scans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scans}),signal:controller.signal});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'Gemini duplicate check failed');
    const candidates=UWScanDuplicates.cleanupCandidates(scans,result.groups||[]);
    scanCleanupReview={candidates,selected:new Set(),model:result.model,checked:result.checked};
    // Do not reopen a dialog the operator deliberately closed.
    if(document.querySelector('#modal-root h3')?.textContent==='Gemini duplicate check')showDuplicateCleanupReview();
    else toast('Duplicate check complete. Click Delete duplicates to review the results.');
  }catch(error){const message=error.name==='AbortError'?'Gemini duplicate check timed out; nothing was removed':error.message;toast(message);if(document.querySelector('#modal-root h3')?.textContent==='Gemini duplicate check')modal('<h3>Duplicate check needs another attempt</h3><p>'+escapeHtml(message)+'</p><p>Every original receipt is retained. No documents were removed.</p><button class="btn" onclick="closeModal()">Close</button><button class="btn gold" onclick="startAiDuplicateCleanup()">Retry check</button>');}
  finally{clearTimeout(timeout);scanCleanupRunning=false;endScanOperation('duplicate-check');}
}
function showDuplicateCleanupReview(){
  const review=scanCleanupReview;if(!review)return;
  const rows=review.candidates.map((candidate,index)=>`<tr><td><input type="checkbox" aria-label="Remove ${escapeHtml(candidate.name)}" ${review.selected.has(candidate.id)?'checked':''} onchange="if(this.checked)scanCleanupReview.selected.add(scanCleanupReview.candidates[${index}].id);else scanCleanupReview.selected.delete(scanCleanupReview.candidates[${index}].id)"></td><td>${escapeHtml(candidate.name)} <button class="btn sm" onclick="viewDuplicateCleanupScan(${index},false)">View</button></td><td>${escapeHtml(candidate.keepName)} <button class="btn sm" onclick="viewDuplicateCleanupScan(${index},true)">View original</button></td><td>${escapeHtml(candidate.reason)}</td></tr>`).join('');
  modal(`<h3>Review Gemini duplicate candidates</h3><p>${review.checked} scans checked. Select only confirmed duplicates. Approved scans are protected. Removed scans and their original files are retained for Undo; nothing is posted to the ledger.</p><div style="max-height:55vh;overflow:auto"><table><tr><th>Select</th><th>Remove from active scans</th><th>Keep</th><th>Evidence</th></tr>${rows||'<tr><td colspan="4">No removable duplicate candidates found. Unreadable or incomplete receipts still need individual AI review.</td></tr>'}</table></div><div class="toolbar"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn" onclick="scanCleanupReview=null;startAiDuplicateCleanup()">Check again</button>${rows?'<button class="btn gold" onclick="confirmDuplicateCleanup()">Remove selected duplicates</button>':''}</div>`);
}
function viewDuplicateCleanupScan(index,original){
  const candidate=scanCleanupReview?.candidates[index];if(!candidate)return;
  const scan=(DB.scannedDocuments||[]).find(doc=>String(doc.id)===(original?candidate.keepId:candidate.id));
  if(!scan){toast('This scan changed; run the duplicate check again');return;}
  viewDocument(scan);
  document.getElementById('modal-root').insertAdjacentHTML('beforeend','<button class="btn" onclick="showDuplicateCleanupReview()">Back to duplicate review</button>');
}
async function confirmDuplicateCleanup(){
  if(scanOperations.size){toast('Wait for the current review or cleanup to finish');return;}
  const review=scanCleanupReview;if(!review)return;
  const selected=review.candidates.filter(candidate=>review.selected.has(candidate.id));
  if(!selected.length){toast('Select the duplicates you have confirmed first');return;}
  const batch='duplicate-cleanup-'+Date.now();let removed=0;
  for(const candidate of selected){
    const scan=(DB.scannedDocuments||[]).find(doc=>String(doc.id)===candidate.id);
    const keeper=(DB.scannedDocuments||[]).find(doc=>String(doc.id)===candidate.keepId);
    if(!scan||!keeper?.canonical||!scan.canonical||scan.includedInTotals||scan.reviewStatus==='Approved'||UWScanDuplicates.fingerprint(scan)!==candidate.fingerprint||UWScanDuplicates.fingerprint(keeper)!==candidate.keepFingerprint)continue;
    scan.duplicateArchive={batch,archivedAt:new Date().toISOString(),keepId:candidate.keepId,reason:candidate.reason,canonical:scan.canonical};
    scan.canonical=false;removed++;
  }
  if(!removed){toast('Candidates changed or were approved; nothing was removed. Check again.');return;}
  beginScanOperation('duplicate-save',`Running duplicate cleanup · saving ${removed} scans`);
  try{
    DB.meta={...(DB.meta||{}),lastDuplicateCleanup:batch};save();scanCleanupReview=null;closeModal();render();updateScanRunningStatus();
    const saved=await syncServerState(true,true);
    toast(`${removed} duplicates removed from active scans${saved?.serverSaved?' · shared save confirmed':' · shared save pending'}. Original files retained; Undo cleanup is available.`);
  }catch(error){toast('Cleanup is retained locally; shared save is pending. Original files and Undo are available.');}
  finally{endScanOperation('duplicate-save');}
}
function undoDuplicateCleanup(){
  if(scanOperations.size){toast('Wait for the current review or cleanup to finish');return;}
  const batch=DB.meta?.lastDuplicateCleanup;if(!batch)return;
  let restored=0;
  for(const scan of DB.scannedDocuments||[]){if(scan.duplicateArchive?.batch!==batch)continue;scan.canonical=scan.duplicateArchive.canonical;delete scan.duplicateArchive;restored++;}
  const remaining=(DB.scannedDocuments||[]).filter(scan=>scan.duplicateArchive).sort((a,b)=>String(b.duplicateArchive.archivedAt).localeCompare(String(a.duplicateArchive.archivedAt)));
  if(remaining.length)DB.meta.lastDuplicateCleanup=remaining[0].duplicateArchive.batch;else delete DB.meta.lastDuplicateCleanup;
  save();scanCleanupReview=null;render();toast(`${restored} scans restored`);
}
