const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const start = html.indexOf('function mergeScannedDocumentState(');
const end = html.indexOf('function load(){', start);
assert.notEqual(start, -1, 'Scanned document migration helper was not found.');
assert.notEqual(end, -1, 'Scanned document migration helper end was not found.');

const context = { Map, Set, String, Number, Boolean, Array };
vm.createContext(context);
vm.runInContext(
  `${html.slice(start, end)};globalThis.merge=mergeScannedDocumentState;`,
  context,
  { timeout: 1000 },
);

const run = () => {
  const previous = [
    {
      id: 'bundled-1',
      hash: 'bundled-hash-1',
      name: 'bundled-scan.pdf',
      reviewStatus: 'AI reviewed',
      aiReview: { successful: true, confidence: 0.97 },
      scanDate: '2026-09-20',
      amount: 123.45,
    },
    {
      id: 'uploaded-1',
      hash: 'uploaded-hash-1',
      name: 'local-upload.pdf',
      reviewStatus: 'AI reviewed',
      aiReview: { successful: true, confidence: 0.91 },
      scanDate: '2026-09-21',
      amount: 456.78,
    },
  ];
  const bundled = [
    { id: 'bundled-1', hash: 'bundled-hash-1', name: 'bundled-scan.pdf', reviewStatus: 'Needs review' },
    { id: 'bundled-2', hash: 'bundled-hash-2', name: 'new-bundled-scan.pdf', reviewStatus: 'Needs review' },
  ];
  const merged = context.merge(previous, bundled);

  assert.equal(merged.length, 3, 'A bundle version change must retain locally uploaded scans.');
  assert.equal(merged[0].reviewStatus, 'AI reviewed');
  assert.equal(merged[0].amount, 123.45);
  assert.equal(merged[1].reviewStatus, 'Needs review');
  assert.equal(merged[2].id, 'uploaded-1');
  assert.equal(merged[2].reviewStatus, 'AI reviewed');
  assert.equal(merged[2].amount, 456.78);

  const noHash = context.merge(
    [{ id: 'legacy-1', name: 'one.pdf' }, { id: 'legacy-2', name: 'two.pdf' }],
    [{ id: 'legacy-1', name: 'one.pdf' }, { id: 'legacy-2', name: 'two.pdf' }],
  );
  assert.equal(noHash.length, 2, 'Legacy records without hashes must not collide during migration.');
  console.log('Scanned-data version changes preserve AI review results and locally uploaded scans.');
};

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
