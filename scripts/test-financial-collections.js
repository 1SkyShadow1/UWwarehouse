const test=require('node:test');
const assert=require('node:assert/strict');
const collections=require('../public/js/financial-collections');
const assistant=require('../public/js/assistant-core');

test('dated receipts are attributed to payment month without double counting',()=>{
  const db={
    invoices:[{id:'INV-OLD',date:'2026-10-28',items:[{qty:1,price:200}],paid:150}],
    receipts:[{id:1,invoiceId:'INV-OLD',date:'2026-11-02',amount:100},{id:2,invoiceId:'INV-OLD',date:'2026-10-30',amount:50}],
  };
  assert.equal(collections.summarize(db,'2026-11','2026-11-03').total,100);
  assert.equal(collections.summarize(db,'2026-10','2026-11-03').total,50);
  assert.equal(collections.summarize(db,'','2026-11-03').total,150);
});

test('unreceipted historical balances and deposits remain on invoice date',()=>{
  const db={
    invoices:[
      {id:'LEGACY',date:'2026-10-31',paid:60,deposit:20},
      {id:'PARTIAL',date:'2026-10-15',paid:100,deposit:10},
    ],
    receipts:[{id:1,invoiceId:'PARTIAL',date:'2026-11-01',amount:40}],
  };
  const october=collections.summarize(db,'2026-10','2026-11-03');
  const november=collections.summarize(db,'2026-11','2026-11-03');
  assert.equal(october.total,150);
  assert.equal(october.invoiceFallbackCount,2);
  assert.equal(november.total,40);
  assert.equal(collections.summarize(db,'','2026-11-03').total,190);
});

test('undated receipts fall back to invoice date and unlinked receipts stay excluded and visible',()=>{
  const db={
    invoices:[{id:'I',date:'2026-11-02',paid:100}],
    receipts:[
      {id:1,invoiceId:'I',date:'',amount:60},
      {id:2,invoiceId:'missing',date:'2026-11-03',amount:25},
    ],
  };
  const result=collections.summarize(db,'2026-11','2026-11-03');
  assert.equal(result.total,100);
  assert.equal(result.receiptAmount,0);
  assert.equal(result.invoiceFallbackAmount,100);
  assert.equal(result.unlinkedReceiptAmount,25);
  assert.equal(result.unlinkedReceiptCount,1);
});

test('receipt amounts above invoice aggregates are counted once on payment date',()=>{
  const db={
    invoices:[{id:'I',date:'2026-10-30',paid:50}],
    receipts:[{id:1,invoiceId:'I',date:'2026-11-01',amount:75}],
  };
  assert.equal(collections.summarize(db,'2026-11','2026-11-03').total,75);
  assert.equal(collections.summarize(db,'','2026-11-03').total,75);
  assert.equal(collections.summarize(db,'2026-10','2026-11-03').total,0);
});

test('VAT-inclusive receipts reconcile against ex-VAT invoice payments and preserve gross collections',()=>{
  const db={
    invoices:[{id:'VAT',date:'2026-10-30',paid:80,deposit:20}],
    receipts:[{id:1,invoiceId:'VAT',date:'2026-11-01',amount:92,invoiceAmount:80,vatAmount:12,paymentBasis:'inclusive'}],
  };
  const october=collections.summarize(db,'2026-10','2026-11-03');
  const november=collections.summarize(db,'2026-11','2026-11-03');
  assert.equal(october.total,20);
  assert.equal(november.total,92);
  assert.equal(collections.summarize(db,'','2026-11-03').total,112);
});

test('YTD excludes future receipts and duplicate invoice/receipt IDs',()=>{
  const duplicateInvoice={id:'I',date:'2026-01-01',paid:200};
  const db={
    invoices:[duplicateInvoice,{...duplicateInvoice,paid:900}],
    receipts:[
      {id:'R',invoiceId:'I',date:'2026-11-03',amount:50},
      {id:'R',invoiceId:'I',date:'2026-11-03',amount:50},
      {id:'FUTURE',invoiceId:'I',date:'2026-11-04',amount:50},
    ],
  };
  const result=collections.summarize(db,'ytd:2026','2026-11-03');
  assert.equal(result.total,150);
  assert.equal(result.receiptAmount,50);
  assert.equal(result.invoiceFallbackAmount,100);
  assert.equal(result.receiptCount,1);
});

test('assistant summaries use the same payment-date income as the dashboard',()=>{
  const db={
    invoices:[{id:'I',date:'2026-10-31',items:[{qty:1,price:100}],paid:100}],
    receipts:[{id:1,invoiceId:'I',date:'2026-11-02',amount:100}],
    expenses:[],quotes:[],jobs:[],payables:[],wages:[],stock:[],scannedDocuments:[],fnbStatements:[],
  };
  const report=assistant.analyze(db,{asOf:'2026-11-03',period:'2026-11'});
  assert.equal(report.summary.collected,100);
  assert.equal(report.summary.receiptIncome,100);
  assert.equal(report.summary.invoiceFallbackIncome,0);
  assert.match(assistant.evidence(report,'income').financialBasis,/payment date/);
});
