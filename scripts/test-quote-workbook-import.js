const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ExcelJS = require('exceljs');
const { parseQuoteWorkbook, QuoteImportError } = require('../lib/quote-workbook-import');

async function loadTemplate() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(__dirname, '..', 'public', 'Quote Template.xlsx'));
  workbook.worksheets[0].getCell('C5').value = 'Alec Rakow';
  return workbook;
}

async function parseTemplate(workbook) {
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return parseQuoteWorkbook(buffer, 'manual-quote.xlsx');
}

test('imports template customer data, dates, notes, ordered lines, and checked totals', async () => {
  const quote = await parseTemplate(await loadTemplate());
  assert.equal(quote.id, 'BB09092605');
  assert.equal(quote.customer, 'Alec Rakow');
  assert.equal(quote.date, '2026-09-09');
  assert.equal(quote.expiry, '2026-10-09');
  assert.equal(quote.preparedBy, 'Brian Raymond');
  assert.equal(quote.projectReference, 'PVT Residence');
  assert.match(quote.introduction, /6 x Dining Chairs/);
  assert.equal(quote.items.length, 9);
  assert.equal(quote.items[0].desc, 'Dining Chairs - Fabric');
  assert.deepEqual(quote.items[0], { desc: 'Dining Chairs - Fabric', qty: 12, price: 170 });
  assert.equal(quote.items[8].desc, 'Two Seater Couch - Consumables');
  assert.equal(quote.sourceTotal, 21570);
  assert.equal(quote.status, 'Draft');
  assert.equal(quote.reviewStatus, 'Needs review');
  assert.equal(quote.includedInTotals, false);
  assert.ok(quote.sourceTerms.length);
  assert.equal(quote.sourceWorkbookName, 'manual-quote.xlsx');
});

test('rejects line and grand totals that disagree with the source lines', async () => {
  const workbook = await loadTemplate();
  workbook.worksheets[0].getCell('F22').value = 2041;
  await assert.rejects(() => parseTemplate(workbook), /Line total on line 1 does not match/);

  const secondWorkbook = await loadTemplate();
  secondWorkbook.worksheets[0].getCell('F22').value = { formula: 'E22*D22', result: 2040 };
  secondWorkbook.worksheets[0].getCell('F32').value = 21571;
  await assert.rejects(() => parseTemplate(secondWorkbook), /Quote grand total .* does not match/);
});

test('rejects missing financial values and incomplete quote identity', async () => {
  const workbook = await loadTemplate();
  workbook.worksheets[0].getCell('E22').value = null;
  await assert.rejects(() => parseTemplate(workbook), /Unit price on line 1 is missing/);

  const secondWorkbook = await loadTemplate();
  secondWorkbook.worksheets[0].getCell('F5').value = '';
  await assert.rejects(() => parseTemplate(secondWorkbook), /Quote number is required/);
});

test('computes formula totals from explicit line values when Excel has no cached formula result', async () => {
  const workbook = await loadTemplate();
  const sheet = workbook.worksheets[0];
  sheet.getCell('F22').value = { formula: 'E22*D22', result: null };
  sheet.getCell('F32').value = { formula: 'SUM(F22:F31)', result: null };
  const quote = await parseTemplate(workbook);
  assert.equal(quote.sourceTotal, 21570);

  sheet.getCell('F32').value = { formula: 'A1', result: null };
  await assert.rejects(() => parseTemplate(workbook), /grand total formula is not a standard sum/);
});

test('rejects invalid workbook data with an actionable error', async () => {
  await assert.rejects(() => parseQuoteWorkbook(Buffer.from('not an xlsx'), 'quote.xlsx'), QuoteImportError);
  const unrelated = new ExcelJS.Workbook();
  unrelated.addWorksheet('Not a quote').getCell('A1').value = 'Not a quotation';
  const buffer = Buffer.from(await unrelated.xlsx.writeBuffer());
  await assert.rejects(() => parseQuoteWorkbook(buffer, 'quote.xlsx'), /does not match the current quote template/);
});

test('requires explicit source review before an imported quote can be accepted', () => {
  const context = vm.createContext({ today: () => '2026-10-07', toast: () => {}, DB: { invoices: [], quotes: [] } });
  const history = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'quote-history.js'), 'utf8');
  vm.runInContext(history, context);
  const quote = {
    id: 'BB07102601', date: '2026-10-07', expiry: '2026-11-06', customer: 'Client',
    items: [{ desc: 'Work', qty: 1, price: 100 }], status: 'Draft',
    reviewStatus: 'Needs review', sourceDocumentId: 'source',
  };
  assert.equal(context.acceptQuoteVersion(quote), false);
  assert.equal(quote.status, 'Draft');
  quote.reviewStatus = 'Approved';
  assert.equal(context.acceptQuoteVersion(quote), true);
  assert.equal(quote.status, 'Accepted');
});
