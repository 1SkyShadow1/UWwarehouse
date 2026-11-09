const test = require('node:test');
const assert = require('node:assert/strict');
const { createLedgerActivity, MAX_ACTIVITY_BYTES, MAX_ACTIVITY_EVENTS, MAX_EVENT_BYTES } = require('../lib/ledger-activity');

test('records append-only actor, revision, and field-level changes for all tracked ledger records', () => {
  const current = {
    ledgerActivity: [{ id: 'existing', revision: 3, changes: [] }],
    invoices: [{ id: 'I-1', customer: 'Alice', paid: 100, items: [{ desc: 'Chair', qty: 1, price: 250 }] }],
    fnbStatements: [{ id: 'S-1', transactions: [{ id: 'T-1', amount: -50, category: 'Unallocated' }] }],
  };
  const next = {
    ledgerActivity: [{ id: 'forged' }],
    invoices: [{ id: 'I-1', customer: 'Alice Smith', paid: 100, items: [{ desc: 'Chair', qty: 1, price: 275 }] }],
    fnbStatements: [{ id: 'S-1', transactions: [{ id: 'T-1', amount: -50, category: 'Materials' }] }],
  };

  const result = createLedgerActivity(current, next, { revision: 4, actor: 'brian@example.test', at: '2026-11-05T07:00:00.000Z' });
  assert.equal(result.ledgerActivity.length, 2);
  assert.equal(result.ledgerActivity[0].id, 'existing');
  const event = result.ledgerActivity[1];
  assert.equal(event.revision, 4);
  assert.equal(event.actor, 'brian@example.test');
  assert.equal(event.changeCount, 2);
  assert.equal(event.complete, true);
  const changedFields = event.changes.flatMap(change => change.fields.map(field => `${change.collection}.${field.field}`));
  assert(changedFields.some(field => field === 'invoices.items[0].price'));
  assert(changedFields.some(field => field === 'invoices.customer'));
  assert(changedFields.some(field => field === 'fnbStatements.transactions[T-1].category'));
});

test('records additions and removals without storing credentials or document binaries', () => {
  const current = { expenses: [{ id: 'E-1', amount: 25, apiKey: 'secret' }] };
  const next = {
    expenses: [{ id: 'E-1', amount: 30, apiKey: 'different-secret' }, { id: 'E-2', amount: 10, data: 'base64-image' }],
    receipts: [],
  };
  const result = createLedgerActivity(current, next, { revision: 2, actor: 'operator' });
  const serialized = JSON.stringify(result.ledgerActivity);
  assert(!serialized.includes('secret'));
  assert(!serialized.includes('base64-image'));
  assert(result.ledgerActivity[0].changes.some(change => change.id === 'E-2' && change.action === 'added'));

  const removed = createLedgerActivity(next, { expenses: [] }, { revision: 3 });
  assert(removed.ledgerActivity.at(-1).changes.some(change => change.id === 'E-1' && change.action === 'removed'));
  assert(removed.ledgerActivity.at(-1).changes.some(change => change.id === 'E-2' && change.action === 'removed'));
});

test('no-op saves preserve the existing history without inventing a change event', () => {
  const current = { ledgerActivity: [{ id: 'existing', revision: 1 }], quotes: [{ id: 'Q-1', status: 'Draft' }] };
  const result = createLedgerActivity(current, { quotes: [{ id: 'Q-1', status: 'Draft' }] }, { revision: 2 });
  assert.deepEqual(result.ledgerActivity, current.ledgerActivity);
});

test('tracks additional financial and operational collections', () => {
  const current = { bankStatements: [], customers: [], vendors: [], budgets: [], wageOperationalCosts: [], fabrics: [], priceBook: [] };
  const next = {
    bankStatements: [{ id: 'B-1', status: 'Imported' }],
    customers: [{ id: 'C-1', name: 'Customer' }],
    vendors: [{ id: 'V-1', name: 'Vendor' }],
    budgets: [{ id: 'BU-1', amount: 100 }],
    wageOperationalCosts: [{ id: 'W-1', amount: 50 }],
    fabrics: [{ id: 'F-1', code: 'FAB-1' }],
    priceBook: [{ id: 'P-1', price: 25 }],
  };
  const event = createLedgerActivity(current, next, { revision: 1 }).ledgerActivity[0];
  assert.deepEqual(new Set(event.changes.map(change => change.collection)), new Set(Object.keys(next)));
});

test('bounds serialized event detail while preserving original change counts', () => {
  const previous = [], next = [];
  for (let index = 0; index < 1000; index += 1) {
    const before = { id: `E-${index}` }, after = { id: `E-${index}` };
    for (let field = 0; field < 120; field += 1) {
      before[`field${field}`] = 'before';
      after[`field${field}`] = 'after';
    }
    previous.push(before);
    next.push(after);
  }
  const event = createLedgerActivity({ expenses: previous }, { expenses: next }, { revision: 2 }).ledgerActivity[0];
  assert.equal(event.changeCount, 1000);
  assert.equal(event.fieldCount, 120000);
  assert.equal(event.complete, false);
  assert(Buffer.byteLength(JSON.stringify(event), 'utf8') <= MAX_EVENT_BYTES);
  assert(event.omittedFields > 0);
});

test('bounds retained history and reports discarded event coverage', () => {
  const prior = Array.from({ length: MAX_ACTIVITY_EVENTS + 5 }, (_, index) => ({
    id: `change-${index + 1}`,
    revision: index + 1,
    at: '2026-11-05T07:00:00.000Z',
    changes: [],
  }));
  const result = createLedgerActivity(
    { ledgerActivity: prior, ledgerActivityCoverage: { trackingStartedAt: '2026-11-01T00:00:00.000Z' }, quotes: [{ id: 'Q-1', status: 'Draft' }] },
    { quotes: [{ id: 'Q-1', status: 'Accepted' }] },
    { revision: prior.length + 1, at: '2026-11-06T07:00:00.000Z' },
  );
  assert.equal(result.ledgerActivity.length, MAX_ACTIVITY_EVENTS);
  assert.equal(result.ledgerActivityCoverage.retainedFromRevision, 7);
  assert.equal(result.ledgerActivityCoverage.retainedThroughRevision, prior.length + 1);
  assert.equal(result.ledgerActivityCoverage.discardedEvents, 6);
  assert.equal(result.ledgerActivityCoverage.discardedThroughRevision, 6);
  assert(result.ledgerActivityCoverage.retainedBytes <= result.ledgerActivityCoverage.maxRetainedBytes);
});

test('enforces the retained-history byte limit and records the oldest discarded revision', () => {
  const prior = Array.from({ length: 22 }, (_, index) => ({
    id: `change-${index + 1}`,
    revision: index + 1,
    at: '2026-11-05T07:00:00.000Z',
    detail: 'x'.repeat(245000),
    changes: [],
  }));
  const result = createLedgerActivity(
    { ledgerActivity: prior, quotes: [{ id: 'Q-1', status: 'Draft' }] },
    { quotes: [{ id: 'Q-1', status: 'Accepted' }] },
    { revision: prior.length + 1, at: '2026-11-06T07:00:00.000Z' },
  );
  assert(result.ledgerActivityCoverage.retainedBytes <= MAX_ACTIVITY_BYTES);
  assert(result.ledgerActivityCoverage.discardedEvents > 0);
  assert.equal(result.ledgerActivityCoverage.discardedThroughRevision, result.ledgerActivity[0].revision - 1);
});
