function quoteForJob(job){
  const invoice=DB.invoices?.find(item=>String(item.id)===String(job.invoiceId));
  const quoteId=job.quoteId||invoice?.generatedFromQuote||job.id;
  const quote=(DB.quotes||[]).find(item=>String(item.id)===String(quoteId))||null;
  return invoice?.acceptedQuoteSnapshot||job.acceptedQuoteSnapshot||quote?.acceptedVersion?.snapshot||quote;
}
function syncQuoteJob(quote,previousId=quote.id){
  DB.jobs=Array.isArray(DB.jobs)?DB.jobs:[];
  let job=DB.jobs.find(item=>String(item.quoteId||'')===String(previousId));
  if(!job)job=DB.jobs.find(item=>String(item.id)===String(previousId));
  if(!job){
    const usedIds=new Set(DB.jobs.map(item=>String(item.id)));
    let id=`JOB-${quote.id}`,suffix=2;
    while(usedIds.has(id))id=`JOB-${quote.id}-${suffix++}`;
    job={id,quoteId:quote.id,stage:'Quoted',createdAt:new Date().toISOString(),productionElapsedMs:0,createdFromQuote:true};
    DB.jobs.unshift(job);
  }
  Object.assign(job,{
    quoteId:quote.id,
    customer:quote.customer||'',
    project:quote.projectReference||quote.project||'',
    intakeDate:quote.date||'',
    workType:quote.workType||'Reupholster',
    colour:quote.colour||'',
    quoteStatus:quote.status||'Draft',
  });
  if(quote.status==='Accepted'){
    const snapshot=quote.acceptedVersion?.snapshot||quote;
    job.acceptedQuoteSnapshot=JSON.parse(JSON.stringify(snapshot));
    delete job.acceptedQuoteSnapshot.revisions;
    delete job.acceptedQuoteSnapshot.acceptedVersion;
  }
  return job;
}
function jobProductionElapsedMs(job,now=Date.now()){
  const recorded=Math.max(0,Number(job.productionElapsedMs)||0);
  const stage=String(job.stage||'').trim();
  if(!['In production','In Production','In progress'].includes(stage)||!job.productionStartedAt)return recorded;
  const started=Date.parse(job.productionStartedAt);
  return recorded+(Number.isFinite(started)?Math.max(0,now-started):0);
}
function formatJobProductionElapsed(job,now=Date.now()){
  const elapsed=jobProductionElapsedMs(job,now);
  if(elapsed<=0)return job.stage==='In production'&&!job.productionStartedAt?'Start date not recorded':'Not started';
  const hours=Math.floor(elapsed/3600000),days=Math.floor(hours/24),remainingHours=hours%24;
  if(days===0)return 'Less than 1 day';
  return `${days} day${days===1?'':'s'}${remainingHours?` ${remainingHours} hr${remainingHours===1?'':'s'}`:''}`;
}
function setJobProductionStage(job,stage,now=new Date()){
  const rawCurrent=String(job.stage||'Quoted').trim();
  const current=({'In Production':'In production','In progress':'In production','Quote':'Quoted','Quoted ':'Quoted'})[rawCurrent]||rawCurrent;
  if(current===stage)return false;
  const timestamp=now instanceof Date?now.toISOString():new Date(now).toISOString();
  if(current==='In production'&&job.productionStartedAt){
    const started=Date.parse(job.productionStartedAt);
    if(Number.isFinite(started))job.productionElapsedMs=jobProductionElapsedMs(job,Date.parse(timestamp));
    job.productionStartedAt='';
  }
  if(stage==='In production'&&current!=='In production')job.productionStartedAt=timestamp;
  job.stageHistory=Array.isArray(job.stageHistory)?job.stageHistory:[];
  job.stageHistory.push({from:current,to:stage,changedAt:timestamp});
  job.stage=stage;
  return true;
}
function jobFabricItems(quote){
  return (quote?.items||[]).filter(item=>item.item==='Fabric'||item.fabricId||item.fabricDescription);
}
function jobFabricName(item){
  const fabric=item.fabricId&&typeof findFabric==='function'?findFabric(item.fabricId):null;
  return fabric?.desc||item.fabricDescription||item.fabricSource?.description||item.desc||'Fabric';
}
function jobDaysSince(date,now=new Date()){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return null;
  const start=Date.parse(`${date}T00:00:00Z`),end=Date.parse(`${now.toISOString().slice(0,10)}T00:00:00Z`);
  if(!Number.isFinite(start)||!Number.isFinite(end))return null;
  return Math.max(0,Math.floor((end-start)/86400000));
}
