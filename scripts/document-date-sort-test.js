const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const start = html.indexOf('const dateSortableDocumentLists=');
const end = html.indexOf('function setDocFilter', start);
assert.notEqual(start, -1, 'date sort helpers should exist');
assert.notEqual(end, -1, 'date sort helper block should end before filter handlers');

let renderCount = 0;
const context = { state: { docFilters: {} }, render() { renderCount += 1; } };
vm.createContext(context);
vm.runInContext(
  `${html.slice(start, end)}
   this.sortDocumentsByDate = sortDocumentsByDate;
   this.toggleDocumentDateSort = toggleDocumentDateSort;
   this.documentDateSortControl = documentDateSortControl;`,
  context,
);

const records = [
  { id: 'old', date: '2024-03-10' },
  { id: 'new', date: '2026-02-05' },
  { id: 'undated' },
  { id: 'middle', date: '2025-08-01' },
  { id: 'same-date-stable', date: '2025-08-01' },
];
const originalOrder = records.map(record => record.id);

assert.deepEqual(
  Array.from(context.sortDocumentsByDate(records, 'invoices'), record => record.id),
  ['new', 'middle', 'same-date-stable', 'old', 'undated'],
  'default order should be newest first with undated records last',
);
assert.deepEqual(records.map(record => record.id), originalOrder, 'sorting must not mutate the source list');

context.toggleDocumentDateSort('invoices');
assert.deepEqual(
  Array.from(context.sortDocumentsByDate(records, 'invoices'), record => record.id),
  ['old', 'middle', 'same-date-stable', 'new', 'undated'],
  'the toggle should switch to oldest first without moving undated records to the top',
);
assert.match(context.documentDateSortControl('invoices'), /Oldest first/);
assert.equal(renderCount, 1, 'toggling the sort should rerender the current view');

const inferredDates = [
  { id: 'unknown', name: 'contract.docx' },
  { id: 'year', year: '2023' },
  { id: 'upload-1780000000000', name: 'uploaded.pdf' },
  { id: 'filename', name: 'statement-2025-11-02.pdf' },
];
assert.deepEqual(
  Array.from(context.sortDocumentsByDate(inferredDates, 'documents'), record => record.id),
  ['upload-1780000000000', 'filename', 'year', 'unknown'],
  'document-register dates should be inferred from upload ids, filenames, or year metadata where available',
);

console.log('Document date sorting tests passed.');
