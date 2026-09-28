const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const bankSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'bank-statements.js'), 'utf8');
const amountStart = indexHtml.indexOf('function extractedDocumentAmount(');
const amountEnd = indexHtml.indexOf('function crossReferenceSummary(', amountStart);
const reviewStart = indexHtml.indexOf('function fnbReviewCandidate(');
const reviewEnd = indexHtml.indexOf('async function aiReviewDocument(doc){', reviewStart);
assert.notEqual(amountStart, -1, 'Receipt extraction helpers were not found.');
assert.notEqual(amountEnd, -1, 'Receipt extraction helpers end was not found.');
assert.notEqual(reviewStart, -1, 'FNB reconciliation helper was not found.');
assert.notEqual(reviewEnd, -1, 'FNB reconciliation helper end was not found.');

const context = {
  DB: { fnbStatements: [], scannedDocuments: [] },
  Date,
  Math,
  Number,
  String,
  Array,
  Set,
  scannedDate: document => {
    const match = String(document.name || '').match(/(20\d{2})(\d{2})(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  },
  geminiReviewComplete: document => Boolean(document?.aiReview?.successful),
  toast: message => { context.messages.push(message); },
  save: () => { context.saveCount += 1; },
  render: () => {},
  messages: [],
  saveCount: 0,
  fnbTransactionAmount: transaction => {
    const amount = Number(transaction?.amount);
    if (Number.isFinite(amount) && amount !== 0) return amount;
    const debit = Number(transaction?.debit), credit = Number(transaction?.credit);
    return debit > 0 ? -Math.abs(debit) : credit > 0 ? Math.abs(credit) : 0;
  },
};
vm.createContext(context);
vm.runInContext(
  `${indexHtml.slice(amountStart, amountEnd)}${indexHtml.slice(reviewStart, reviewEnd)};globalThis.compare=crossReferenceFnbPurchase;globalThis.review=reviewAgainstFnb;globalThis.approve=approveFnbReviewed;`,
  context,
  { timeout: 1000 },
);

const statements = {
  statementDate: '2026-09-30',
  id: 'fnb-test',
  name: 'FNB test statement',
  transactions: [
    { id: 'debit-1', date: '2026-09-25', description: 'POS Purchase Acme Stationery', amount: -123.45 },
    { id: 'credit-1', date: '2026-09-25', description: 'Acme Stationery refund', amount: 123.45 },
  ],
};

const run = () => {
  context.DB.fnbStatements = [statements];
  const aiOnlyReceipt = {
    id: 'scan-1',
    aiReview: { successful: true, documentDate: '2026-09-26', merchant: 'Acme Stationery', amountPaid: 123.45, documentType: 'receipt' },
  };
  const matched = context.compare(aiOnlyReceipt);
  assert.equal(matched.status, 'matched', 'Gemini-extracted receipt fields should match a statement debit.');
  assert.equal(matched.accountConfirmed, true);
  assert.equal(matched.transaction.id, 'debit-1');
  assert.equal(matched.statementName, 'FNB test statement');

  const savedReceipt = { ...aiOnlyReceipt, path: '/receipt-1.png' };
  context.DB.scannedDocuments = [savedReceipt];
  context.review(savedReceipt.path);
  assert.equal(savedReceipt.fnbReview.transaction.id, 'debit-1', 'The Review FNB action must save its comparison result onto the scan.');
  assert.equal(context.saveCount, 1);
  context.approve(savedReceipt.path);
  assert.equal(savedReceipt.reviewStatus, 'Approved', 'A confirmed statement match may be approved.');
  assert.equal(savedReceipt.includedInTotals, true);

  const duplicateReceipt = {
    id: 'scan-2',
    aiReview: { successful: true, documentDate: '2026-09-26', merchant: 'Acme Stationery', amountPaid: 123.45 },
  };
  const reused = context.compare(duplicateReceipt);
  assert.equal(reused.status, 'already-matched', 'One statement debit must not be confirmed against multiple scans.');
  assert.equal(reused.accountConfirmed, false);

  assert.equal(context.compare({
    id: 'scan-missing',
    aiReview: { successful: true, merchant: 'Acme Stationery', amountPaid: 123.45 },
  }).status, 'insufficient-receipt-data', 'A receipt without a date must not match by amount alone.');
  context.DB.scannedDocuments = [];
  assert.equal(context.compare({
    id: 'scan-equal-credit',
    scanDate: '2026-09-25',
    amount: 123.45,
    merchant: 'Acme Stationery',
  }).status, 'matched', 'A debit must match even when an equal-value credit also exists.');
  assert.equal(context.compare({
    id: 'scan-wrong-vendor',
    scanDate: '2026-09-25',
    amount: 123.45,
    merchant: 'Different Supplier',
  }).status, 'not-matched', 'A known merchant mismatch must not be reported as a match.');
  context.DB.scannedDocuments = [{
    id: 'scan-unmatched',
    path: '/receipt-unmatched.png',
    fnbReview: { accountConfirmed: false },
  }];
  context.approve('/receipt-unmatched.png');
  assert.notEqual(context.DB.scannedDocuments[0].reviewStatus, 'Approved', 'An unmatched receipt must not be approved via FNB confirmation.');

  context.DB.scannedDocuments = [];
  context.DB.fnbStatements = [{
    ...statements,
    transactions: [
      { id: 'ambiguous-1', date: '2026-09-25', description: 'POS Purchase Acme Stationery', amount: -123.45 },
      { id: 'ambiguous-2', date: '2026-09-25', description: 'POS Purchase Acme Stationery', amount: -123.45 },
    ],
  }];
  assert.equal(context.compare(aiOnlyReceipt).status, 'ambiguous', 'Equally good bank rows must not be auto-selected.');

  const bankContext = { window: {} };
  vm.runInNewContext(bankSource, bankContext, { timeout: 1000 });
  const realStatements = bankContext.window.UW_FNB_STATEMENTS.statements;
  const allTransactions = realStatements.flatMap(statement => statement.transactions.map(transaction => ({
    ...transaction,
    statementId: statement.id,
    statementName: statement.name,
  })));
  const uniqueDebit = allTransactions.find(transaction => {
    if (!(Number(transaction.amount) < 0)) return false;
    const sameAmountDate = allTransactions.filter(candidate =>
      Number(candidate.amount) < 0
      && candidate.date === transaction.date
      && Math.abs(Number(candidate.amount) - Number(transaction.amount)) < 0.01,
    );
    return sameAmountDate.length === 1;
  });
  assert.ok(uniqueDebit, 'Bundled FNB data should provide an unambiguous debit for an integration-style test.');
  context.DB.scannedDocuments = [];
  context.DB.fnbStatements = realStatements;
  const importedMatch = context.compare({
    id: 'scan-imported-row',
    scanDate: uniqueDebit.date,
    amount: Math.abs(Number(uniqueDebit.amount)),
    merchant: uniqueDebit.description,
  });
  assert.equal(importedMatch.status, 'matched', 'Scanned receipt comparison must use the bundled statement transaction rows.');
  assert.equal(importedMatch.transaction.id, uniqueDebit.id);
  assert.equal(importedMatch.statementId, uniqueDebit.statementId);

  console.log('FNB receipt review compares extracted receipt data with statement debits and flags missing, duplicate, or ambiguous matches.');
};

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
