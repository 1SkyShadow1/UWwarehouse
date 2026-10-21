const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { searchSourceFiles, extractDocumentText } = require('../lib/assistant-source-search');
const { validateAssistantProposals } = require('../lib/assistant-source-reconciliation');

const makePdf = () => new Promise((resolve, reject) => {
  const pdf = new PDFDocument();
  const chunks = [];
  pdf.on('data', chunk => chunks.push(chunk));
  pdf.on('error', reject);
  pdf.on('end', () => resolve(Buffer.concat(chunks)));
  pdf.text('Invoice INV-1001 Acme Upholstery Total 1250.00');
  pdf.end();
});

test('source search extracts text from supported local documents and reports bounded coverage', async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uw-assistant-source-'));
  const root = path.join(tempRoot, 'UW');
  fs.mkdirSync(path.join(root, '2026', 'Invoices'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Local Backups'), { recursive: true });
  fs.writeFileSync(path.join(root, '2026', 'Invoices', 'INV-1001.txt'), 'Invoice INV-1001\nCustomer: Acme Upholstery\nTotal: 1250.00');
  fs.writeFileSync(path.join(root, '2026', 'Invoices', 'notes.csv'), 'Reference,Details\nINV-1001,Acme Upholstery total 1250.00');
  fs.writeFileSync(path.join(root, '2026', 'Invoices', 'credentials.txt'), 'INV-1001 secret credential content');
  fs.writeFileSync(path.join(root, '.hidden.txt'), 'INV-1001 hidden content');
  fs.writeFileSync(path.join(root, 'Local Backups', 'old.txt'), 'INV-1001 backup content');
  fs.writeFileSync(path.join(root, '2026', 'Invoices', 'INV-1001.pdf'), await makePdf());
  fs.writeFileSync(path.join(root, '2026', 'Invoices', 'INV-1001.png'), Buffer.from('image fixture'));
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Invoices').addRow(['Invoice', 'Customer', 'Total']).commit?.();
  workbook.getWorksheet('Invoices').addRow(['INV-1001', 'Acme Upholstery', 1250]);
  await workbook.xlsx.writeFile(path.join(root, '2026', 'Invoices', 'register.xlsx'));

  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const result = await searchSourceFiles({ roots: [root], query: 'INV-1001 Acme Upholstery', maxResults: 12 });
  const names = result.matches.map(file => file.name);
  assert(names.includes('INV-1001.txt'));
  assert(names.includes('notes.csv'));
  assert(names.includes('register.xlsx'));
  assert(names.includes('INV-1001.pdf'));
  assert(names.includes('INV-1001.png'));
  assert(!names.includes('credentials.txt'));
  assert(!names.includes('.hidden.txt'));
  assert(!names.includes('old.txt'));
  assert(result.matches.find(file => file.name === 'INV-1001.txt').excerpt.includes('1250.00'));
  assert(result.matches.find(file => file.name === 'INV-1001.png').filenameOnly);
  assert(result.matches.find(file => file.name === 'INV-1001.png').canReview);
  assert.match(result.matches.find(file => file.name === 'INV-1001.txt').sourceHash, /^[a-f0-9]{64}$/);
  assert(result.coverage.filesSearched >= 4);

  const pdfText = await extractDocumentText(path.join(root, '2026', 'Invoices', 'INV-1001.pdf'), fs.readFileSync(path.join(root, '2026', 'Invoices', 'INV-1001.pdf')));
  assert.match(pdfText, /INV-1001/);
  const spreadsheetText = await extractDocumentText(path.join(root, '2026', 'Invoices', 'register.xlsx'), fs.readFileSync(path.join(root, '2026', 'Invoices', 'register.xlsx')));
  assert.match(spreadsheetText, /Acme Upholstery/);
});

test('source search exposes size and file-count limits instead of treating partial coverage as complete', async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uw-assistant-limits-'));
  fs.writeFileSync(path.join(tempRoot, 'large-invoice.txt'), 'Invoice reference INV-LARGE');
  fs.writeFileSync(path.join(tempRoot, 'second.txt'), 'Another invoice');
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const result = await searchSourceFiles({ roots: [tempRoot], query: 'invoice', maxFiles: 1 });
  assert.equal(result.coverage.truncated, true);
  assert.equal(result.coverage.filesFound, 1);
  const tooLarge = await searchSourceFiles({ roots: [tempRoot], query: 'large-invoice', maxFileBytes: 5 });
  assert.equal(tooLarge.coverage.oversizedFiles, 2);
  assert(tooLarge.matches.some(file => file.filenameOnly && !file.canReview));
  const overCombinedLimit = await searchSourceFiles({ roots: [tempRoot], query: 'invoice', maxTotalBytes: 8 });
  assert.equal(overCombinedLimit.coverage.truncated, true);
  assert.equal(overCombinedLimit.coverage.filesSkippedByTotalLimit, 2);
});

test('source reconciliation accepts only evidence-backed allowlisted values for existing records', () => {
  const records = {
    expenses: [{ id: 'E-1', amount: 100, vendor: 'Acme' }],
    invoices: [{ id: 'I-1', paid: 0, customer: 'Acme' }],
  };
  const sources = [{ id: 'source-1', name: 'invoice.txt', relativePath: 'Invoices\\invoice.txt', text: 'Acme invoice amount 125.00 paid 0.00' }];
  const proposals = [
    { collection: 'expenses', recordId: 'E-1', field: 'amount', value: '126.00', reason: 'Low confidence came first.', sourceId: 'source-1', evidence: 'amount 125.00', confidence: 0.5 },
    { collection: 'expenses', recordId: 'E-1', field: 'amount', value: '125.00', reason: 'The source shows the corrected amount.', sourceId: 'source-1', evidence: 'amount 125.00', confidence: 0.95 },
    { collection: 'invoices', recordId: 'I-1', field: 'paid', value: '100', reason: 'Payment was found.', sourceId: 'source-1', evidence: 'paid 0.00', confidence: 0.99 },
    { collection: 'expenses', recordId: 'E-1', field: 'vendor', value: '<img src=x>', reason: 'Unsafe source text.', sourceId: 'source-1', evidence: 'Acme invoice', confidence: 0.9 },
    { collection: 'expenses', recordId: 'E-1', field: 'amount', value: '999', reason: 'Wrong evidence.', sourceId: 'source-1', evidence: 'amount 999', confidence: 0.99 },
    { collection: 'expenses', recordId: 'missing', field: 'amount', value: '130', reason: 'Missing row.', sourceId: 'source-1', evidence: 'amount 125.00', confidence: 0.99 },
    { collection: 'expenses', recordId: 'E-1', field: 'amount', value: '130', reason: 'Low confidence.', sourceId: 'source-1', evidence: 'amount 125.00', confidence: 0.5 },
  ];
  const validated = validateAssistantProposals(proposals, records, sources);
  assert.equal(validated.length, 1);
  assert.equal(validated[0].value, 125);
  assert.equal(validated[0].currentValue, 100);
  assert.equal(validated[0].sourcePath, 'Invoices\\invoice.txt');
  assert.equal(records.expenses[0].amount, 100, 'proposal generation must never mutate source records');
});

test('source reconciliation rejects invalid dates, oversized values, and low-confidence proposals', () => {
  const records = { quotes: [{ id: 'Q-1', expiry: '2026-12-31' }] };
  const sources = [{ id: 's', name: 'quote.txt', relativePath: 'quote.txt', text: 'Expiry 2026-02-28 and extension to 2027-01-31' }];
  const valid = validateAssistantProposals([
    { collection: 'quotes', recordId: 'Q-1', field: 'expiry', value: '2027-01-31', reason: 'Source confirms extension.', sourceId: 's', evidence: 'extension to 2027-01-31', confidence: 0.9 },
    { collection: 'quotes', recordId: 'Q-1', field: 'expiry', value: '2026-02-30', reason: 'Invalid date.', sourceId: 's', evidence: 'Expiry 2026-02-28', confidence: 0.95 },
  ], records, sources);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].value, '2027-01-31');
});
