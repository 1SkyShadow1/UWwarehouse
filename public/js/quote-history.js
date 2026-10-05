// Additive document metadata uses the existing save/restore path.
function dateAfterDays(date,days=30){
  const d=new Date(date+'T12:00:00Z');if(Number.isNaN(d.getTime()))return '';
  d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);
}
function validQuoteExpiry(date,expiry){return !expiry||(/^\d{4}-\d{2}-\d{2}$/.test(expiry)&&dateAfterDays(expiry,0)===expiry&&expiry>=date);}
function quoteValidity(q,asOf=today()){
  if(q.status==='Accepted')return 'Accepted';
  if(!q.expiry)return 'No expiry set';
  if(q.expiry<asOf)return 'Expired';
  return q.expiry<=dateAfterDays(asOf,7)?'Expires soon':'Valid';
}
function quoteSnapshot(q){
  const {revisions,acceptedVersion,...record}=q;
  return JSON.parse(JSON.stringify(record));
}
function initializeQuoteHistory(q){
  q.revision=1;q.revisions=[{number:1,savedAt:new Date().toISOString(),snapshot:quoteSnapshot(q)}];return q;
}
function reviseQuote(q,changes){
  if(Object.keys(changes).every(key=>JSON.stringify(q[key])===JSON.stringify(changes[key])))return false;
  q.revision=q.revision||1;q.revisions=q.revisions||[{number:q.revision,savedAt:null,snapshot:quoteSnapshot(q)}];
  if(q.status==='Accepted'&&!q.acceptedVersion){
    q.acceptedVersion={number:q.revision,acceptedAt:q.invoicedAt||null,snapshot:quoteSnapshot(q)};
    const entry=q.revisions.find(entry=>entry.number===q.revision);if(entry)entry.acceptedSnapshot=quoteSnapshot(q);
  }
  Object.assign(q,changes);q.revision+=1;
  if(q.status==='Accepted')q.status='Draft';
  q.revisions.push({number:q.revision,savedAt:new Date().toISOString(),snapshot:quoteSnapshot(q)});
  return true;
}
function acceptQuoteVersion(q){
  const alreadyAccepted=q.status==='Accepted';
  if(!alreadyAccepted&&!q.expiry){toast('Set the quote expiry date before accepting it.');return false;}
  if(!alreadyAccepted&&!validQuoteExpiry(q.date,q.expiry)){toast('Quote expiry must be on or after its date.');return false;}
  if(!alreadyAccepted&&q.expiry&&q.expiry<today()){toast('This quote has expired. Extend its validity in a new revision before accepting it.');return false;}
  if(!String(q.customer||'').trim()||!q.date||!q.items?.length||q.items.some(item=>!item.desc||item.qty==null||item.qty===''||item.price==null||item.price===''||!Number.isFinite(Number(item.qty)*Number(item.price))||!Number.isFinite(Number(item.qty))||!Number.isFinite(Number(item.price))||Number(item.qty)<0||Number(item.price)<0)){toast('Complete the customer, quote date and valid selling lines before acceptance.');return false;}
  q.revision=q.revision||1;
  if(!q.revisions)q.revisions=[{number:q.revision,savedAt:null,snapshot:quoteSnapshot(q)}];
  q.status='Accepted';
  if(q.acceptedVersion?.number===q.revision)return true;
  q.acceptedVersion={number:q.revision,acceptedAt:new Date().toISOString(),snapshot:quoteSnapshot(q)};
  const entry=q.revisions.find(entry=>entry.number===q.revision);
  if(entry){entry.acceptedAt=q.acceptedVersion.acceptedAt;entry.acceptedSnapshot=JSON.parse(JSON.stringify(q.acceptedVersion.snapshot));}
  return true;
}
function acceptQuote(id){const q=DB.quotes.find(q=>q.id===id);if(!q||!acceptQuoteVersion(q))return;save();render();toast('Quote revision '+q.revision+' accepted');}
function quoteChanges(before,after){
  const changes=[];
  for(const key of ['id','date','expiry','customer','contact','projectReference','workType','colour','introduction'])if((before[key]||'')!==(after[key]||''))changes.push(`${key}: ${before[key]||'—'} → ${after[key]||'—'}`);
  const count=Math.max(before.items?.length||0,after.items?.length||0);
  for(let index=0;index<count;index++){
    const a=before.items?.[index],b=after.items?.[index];
    if(!a||!b)changes.push(`Line ${index+1}: ${a?'removed '+a.desc:'added '+b.desc}`);
    else if(JSON.stringify(a)!==JSON.stringify(b)){
      const fields=[['desc','description'],['qty','quantity'],['price','selling / unit'],['unitCost','cost / unit'],['markupPercent','markup %'],['unit','unit'],['fabricPriceKey','price basis'],['fabricVatBasis','supplier VAT basis'],['code','code'],['item','category']];
      const detail=fields.filter(([key])=>a[key]!==b[key]).map(([key,label])=>`${label}: ${a[key]??'—'} → ${b[key]??'—'}`);
      changes.push(`Line ${index+1}: ${detail.join('; ')||'supplier source or pricing metadata changed'}`);
    }
  }
  return changes;
}
function viewQuoteHistory(id){
  const q=DB.quotes.find(q=>q.id===id);if(!q)return;
  const revisions=q.revisions||[{number:q.revision||1,snapshot:quoteSnapshot(q)}];
  modal(`<h3>Quote revisions — ${escapeHtml(q.id)}</h3>${q.acceptedVersion?`<p>Accepted revision ${q.acceptedVersion.number} · ${escapeHtml(q.acceptedVersion.acceptedAt||'historical acceptance')}</p><button class="btn" onclick="viewAcceptedQuote('${q.id}')">View accepted version</button>`:''}
    <div style="max-height:65vh;overflow:auto">${revisions.map((entry,index)=>`<div class="panel"><h3>Revision ${entry.number} · ${escapeHtml(entry.savedAt||'Historical version')}${entry.acceptedAt?' · Accepted '+escapeHtml(entry.acceptedAt):''}</h3><p>Customer ${escapeHtml(entry.snapshot.customer||'')} · Expiry ${escapeHtml(entry.snapshot.expiry||'not set')} · Total ${R(documentProfit(entry.snapshot.items||[]).sell)}</p><ul>${(index?quoteChanges(revisions[index-1].snapshot,entry.snapshot):['Initial recorded version']).map(text=>`<li>${escapeHtml(text)}</li>`).join('')||'<li>No customer-facing changes</li>'}</ul><button class="btn sm" onclick="viewQuoteRevision('${q.id}',${entry.number})">View this version</button><details><summary>Saved lines</summary><table><tr><th>Description</th><th>Quantity</th><th>Selling / unit</th></tr>${(entry.snapshot.items||[]).map(item=>`<tr><td>${escapeHtml(item.desc)}</td><td>${item.qty}</td><td>${R(item.price)}</td></tr>`).join('')}</table></details></div>`).join('')}</div><button class="btn" onclick="closeModal()">Close</button>`);
}
function viewAcceptedQuote(id){const q=DB.quotes.find(q=>q.id===id);if(q?.acceptedVersion)viewQuote(id,q.acceptedVersion.snapshot);}
function viewQuoteRevision(id,number){
  const q=DB.quotes.find(q=>q.id===id),entry=q?.revisions?.find(entry=>entry.number===number);
  if(entry)viewQuote(id,entry.acceptedSnapshot||entry.snapshot);
}
