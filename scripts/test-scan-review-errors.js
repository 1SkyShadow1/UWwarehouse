const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
const start=html.indexOf('async function requestGeminiReview(doc)');
const end=html.indexOf('async function autoReviewScannedDocument',start);
const source=html.slice(start,end);

test('missing Gemini configuration does not retry and preserves the source',async()=>{
  let calls=0;
  const context=vm.createContext({AbortController,setTimeout,clearTimeout,fetch:async()=>{
    calls++;
    return new Response(JSON.stringify({error:'Gemini is not configured',retryable:false}),{status:503});
  }});
  vm.runInContext(source,context);
  const doc={id:'retained-receipt',name:'receipt.pdf'};
  await assert.rejects(context.requestGeminiReviewWithRetry(doc),/not configured/);
  assert.equal(calls,1);
  assert.equal(doc.id,'retained-receipt');
});

test('transient Gemini failures retry; credential failures stop immediately',async()=>{
  let calls=0,status=502;
  const context=vm.createContext({AbortController,clearTimeout,setTimeout:(fn,delay)=>delay===90000?0:setTimeout(fn,0),fetch:async()=>{
    calls++;
    if(calls===2&&status===502)return new Response('{"provider":"gemini","amountPaid":42}',{status:200});
    return new Response(JSON.stringify({error:'Provider unavailable'}),{status});
  }});
  vm.runInContext(source,context);
  assert.equal((await context.requestGeminiReviewWithRetry({})).amountPaid,42);
  assert.equal(calls,2);
  calls=0;status=403;
  await assert.rejects(context.requestGeminiReviewWithRetry({}));
  assert.equal(calls,1);
});
