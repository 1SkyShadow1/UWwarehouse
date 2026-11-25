const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { parseQuotePdf, QuotePdfImportError } = require('../lib/quote-pdf-import');

async function createQuotePdf({ customer = 'Test Client', total = '250.00', generatedDate = '2026/11/20' } = {}) {
  const document = new PDFDocument({ size: 'A4', margin: 32 });
  const chunks = [];
  document.on('data', chunk => chunks.push(chunk));
  const finished = new Promise(resolve => document.on('end', () => resolve(Buffer.concat(chunks))));
  const text = (value, x, y) => document.text(value, x, y, { lineBreak: false });

  text('QUOTATION', 275, 100);
  text('Client account name', 48, 160);
  if (customer) text(customer, 170, 160);
  text('Quote number', 305, 160);
  text('BB04112601', 514, 160);
  text('Client contact name', 48, 172);
  text('Sharyn Berry', 170, 172);
  text('Date generated', 305, 172);
  text(generatedDate, 517, 172);
  text('Expiry date', 305, 185);
  text('2026/12/04', 517, 185);
  text('Project Reference', 48, 249);
  text('PVT Residence', 170, 249);
  text('Introduction, notes and specifications', 48, 268);
  text('Four chairs, new foam', 48, 282);
  text('Quote line items', 48, 336);
  text('Description', 48, 349);
  text('Qty', 280, 350);
  text('Unit Price', 346, 350);
  text('Total Price', 521, 350);
  text('Chair upholstery - Fabric', 48, 362);
  text('2', 284, 363);
  text('125.00', 360, 363);
  text('250.00', 532, 363);
  text('*TOTAL', 358, 426);
  text(total, 525, 426);
  document.end();
  return finished;
}

async function createImageOnlyPdf() {
  const document = new PDFDocument({ size: 'A4' });
  const chunks = [];
  document.on('data', chunk => chunks.push(chunk));
  const finished = new Promise(resolve => document.on('end', () => resolve(Buffer.concat(chunks))));
  document.end();
  return finished;
}

test('uses the quote number date when importing searchable quote PDF fields and verified totals', async () => {
  const quote = await parseQuotePdf(await createQuotePdf(), 'customer-quote.pdf');
  assert.equal(quote.id, 'BB04112601');
  assert.equal(quote.customer, 'Test Client');
  assert.equal(quote.contact, 'Sharyn Berry');
  assert.equal(quote.date, '2026-11-04');
  assert.equal(quote.expiry, '2026-12-04');
  assert.equal(quote.projectReference, 'PVT Residence');
  assert.equal(quote.introduction, 'Four chairs, new foam');
  assert.deepEqual(quote.items, [{ desc: 'Chair upholstery - Fabric', qty: 2, price: 125 }]);
  assert.equal(quote.sourceTotal, 250);
  assert.equal(quote.sourcePdfName, 'customer-quote.pdf');
  assert.equal(quote.status, 'Draft');
  assert.equal(quote.reviewStatus, 'Needs review');
  assert.equal(quote.includedInTotals, false);
});

test('rejects unreadable or internally inconsistent quote PDFs', async () => {
  await assert.rejects(() => parseQuotePdf(Buffer.from('not a PDF')), QuotePdfImportError);
  const imageOnlyPdf = await createImageOnlyPdf();
  await assert.rejects(() => parseQuotePdf(imageOnlyPdf), /does not match the searchable UW quote layout/);
  const mismatchedPdf = await createQuotePdf({ total: '251.00' });
  await assert.rejects(() => parseQuotePdf(mismatchedPdf), /grand total does not match/);
  const blankCustomer = await parseQuotePdf(await createQuotePdf({ customer: '' }), 'blank-customer.pdf');
  assert.equal(blankCustomer.customer, '');
  assert.equal(blankCustomer.reviewStatus, 'Needs review');
});
