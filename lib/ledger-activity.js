const crypto = require('node:crypto');

const AUDITED_COLLECTIONS = Object.freeze([
  'invoices',
  'quotes',
  'expenses',
  'receipts',
  'jobs',
  'payables',
  'purchases',
  'wages',
  'stock',
  'suppliers',
  'documents',
  'scannedDocuments',
  'fnbStatements',
  'bankStatements',
  'customers',
  'vendors',
  'budgets',
  'wageOperationalCosts',
  'fabrics',
  'priceBook',
]);
const OMIT_KEY = /password|passphrase|token|secret|api.?key|client.?secret|authorization|csrf|base64|binary|buffer|imageData|fileData/i;
const MAX_ROWS_PER_EVENT = 10000;
const MAX_FIELDS_PER_ROW = 120;
const MAX_DEPTH = 6;
const MAX_EVENT_BYTES = 256 * 1024;
const MAX_ACTIVITY_EVENTS = 500;
const MAX_ACTIVITY_BYTES = 5 * 1024 * 1024;

const rows = value => Array.isArray(value) ? value : [];
const stableValue = value => Array.isArray(value)
  ? value.map(stableValue)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
    : value;
const same = (left, right) => {
  try { return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right)); } catch { return Object.is(left, right); }
};

function summarize(value, depth = 0) {
  if (value === undefined) return null;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 240 ? `${value.slice(0, 237)}...` : value;
  if (depth >= 3) return Array.isArray(value) ? `[${value.length} items]` : '[nested object]';
  if (Array.isArray(value)) return value.slice(0, 8).map(item => summarize(item, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 30)) {
      if (!OMIT_KEY.test(key) && !['data', 'blob', 'image', 'bytes'].includes(key.toLowerCase())) {
        output[key.slice(0, 120)] = summarize(item, depth + 1);
      }
    }
    return output;
  }
  return String(value);
}

function keyedRows(value) {
  if (!Array.isArray(value) || !value.every(row => row && typeof row === 'object' && !Array.isArray(row) && (row.id != null || row.sku != null))) return null;
  const keyed = new Map();
  for (const [index, row] of value.entries()) {
    const key = String(row.id ?? row.sku);
    if (!key || keyed.has(key)) return null;
    keyed.set(key, row);
  }
  return keyed;
}

function diffValues(before, after, path, output, counters, depth = 0) {
  if (same(before, after) || counters.fields >= MAX_FIELDS_PER_ROW) {
    if (!same(before, after)) counters.omittedFields += 1;
    return;
  }
  if (depth < MAX_DEPTH && before && after && typeof before === 'object' && typeof after === 'object') {
    const beforeRows = keyedRows(before);
    const afterRows = keyedRows(after);
    if (beforeRows && afterRows) {
      const keys = new Set([...beforeRows.keys(), ...afterRows.keys()]);
      for (const key of keys) {
        const rowPath = `${path}[${key}]`;
        if (!beforeRows.has(key)) diffValues(undefined, afterRows.get(key), rowPath, output, counters, depth + 1);
        else if (!afterRows.has(key)) diffValues(beforeRows.get(key), undefined, rowPath, output, counters, depth + 1);
        else diffValues(beforeRows.get(key), afterRows.get(key), rowPath, output, counters, depth + 1);
      }
      return;
    }
    if (!Array.isArray(before) && !Array.isArray(after)) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (OMIT_KEY.test(key) || ['data', 'blob', 'image', 'bytes'].includes(key.toLowerCase())) continue;
        diffValues(before[key], after[key], path ? `${path}.${key}` : key, output, counters, depth + 1);
      }
      return;
    }
    if (Array.isArray(before) && Array.isArray(after) && before.length === after.length && before.length <= 200) {
      for (let index = 0; index < before.length; index += 1) {
        diffValues(before[index], after[index], `${path}[${index}]`, output, counters, depth + 1);
      }
      return;
    }
  }
  if (counters.fields >= MAX_FIELDS_PER_ROW) {
    counters.omittedFields += 1;
    return;
  }
  output.push({ field: (path || '(record)').slice(0, 200), before: summarize(before), after: summarize(after) });
  counters.fields += 1;
}

function recordKey(record, index) {
  return String(record?.id ?? record?.sku ?? `row-${index + 1}`);
}
function mapRecords(records) {
  const counts = new Map();
  return new Map(rows(records).map((record, index) => {
    const id = recordKey(record, index);
    const count = (counts.get(id) || 0) + 1;
    counts.set(id, count);
    return [count === 1 ? id : `${id}#duplicate-${count}`, record];
  }));
}

function retainActivity(prior, coverage, entry, at) {
  const retained = [...prior, ...(entry ? [entry] : [])];
  let discardedEvents = Number.isSafeInteger(coverage?.discardedEvents) && coverage.discardedEvents > 0
    ? coverage.discardedEvents
    : 0;
  let discardedThroughRevision = coverage?.discardedThroughRevision ?? null;
  let retainedBytes = Buffer.byteLength(JSON.stringify(retained), 'utf8');

  while (retained.length > MAX_ACTIVITY_EVENTS || retainedBytes > MAX_ACTIVITY_BYTES) {
    const discarded = retained.shift();
    discardedEvents += 1;
    if (Number.isSafeInteger(discarded?.revision)) discardedThroughRevision = discarded.revision;
    retainedBytes = Buffer.byteLength(JSON.stringify(retained), 'utf8');
  }

  const activityCoverage = {
    trackingStartedAt: coverage?.trackingStartedAt || prior[0]?.at || (entry ? at : null),
    retainedFromRevision: Number.isSafeInteger(retained[0]?.revision) ? retained[0].revision : null,
    retainedThroughRevision: Number.isSafeInteger(retained.at(-1)?.revision) ? retained.at(-1).revision : null,
    retainedEvents: retained.length,
    retainedBytes,
    discardedEvents,
    discardedThroughRevision,
    maxRetainedEvents: MAX_ACTIVITY_EVENTS,
    maxRetainedBytes: MAX_ACTIVITY_BYTES,
    maxEventBytes: MAX_EVENT_BYTES,
  };
  return { retained, activityCoverage };
}

function boundedEvent(entry) {
  const originalChanges = entry.changes;
  const originalOmittedFields = entry.omittedFields;
  const originalOmittedRows = entry.omittedRows;
  const fieldCount = originalChanges.reduce((total, change) => total + change.fields.length, 0);
  const buildCandidate = (fieldsToRemove, rowsToRemove = 0) => {
    let remainingFields = fieldsToRemove;
    const removedFieldsByChange = new Array(originalChanges.length).fill(0);
    for (let index = originalChanges.length - 1; index >= 0 && remainingFields > 0; index -= 1) {
      removedFieldsByChange[index] = Math.min(remainingFields, originalChanges[index].fields.length);
      remainingFields -= removedFieldsByChange[index];
    }
    const removedRowFields = originalChanges.slice(originalChanges.length - rowsToRemove)
      .reduce((total, change) => total + change.fields.length, 0);
    const changes = originalChanges.slice(0, originalChanges.length - rowsToRemove).map((change, index) => {
      return { ...change, fields: change.fields.slice(0, change.fields.length - removedFieldsByChange[index]) };
    });
    return {
      ...entry,
      omittedFields: originalOmittedFields + Math.max(0, fieldsToRemove - removedRowFields),
      omittedRows: originalOmittedRows + rowsToRemove,
      complete: false,
      changes,
    };
  };
  let low = 0;
  let high = fieldCount;
  let candidate = entry;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const attempt = buildCandidate(middle);
    if (Buffer.byteLength(JSON.stringify(attempt), 'utf8') <= MAX_EVENT_BYTES) high = middle;
    else low = middle + 1;
  }
  if (low) candidate = buildCandidate(low);
  if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_EVENT_BYTES) {
    low = 0;
    high = originalChanges.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const attempt = buildCandidate(fieldCount, middle);
      if (Buffer.byteLength(JSON.stringify(attempt), 'utf8') <= MAX_EVENT_BYTES) high = middle;
      else low = middle + 1;
    }
    candidate = buildCandidate(fieldCount, low);
  }
  if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_EVENT_BYTES) {
    throw new Error('Ledger activity event exceeds its safe size limit.');
  }
  return candidate;
}

function createLedgerActivity(currentData, nextData, { revision, actor = 'System', at = new Date().toISOString() } = {}) {
  const prior = rows(currentData?.ledgerActivity);
  const priorCoverage = currentData?.ledgerActivityCoverage && typeof currentData.ledgerActivityCoverage === 'object'
    ? currentData.ledgerActivityCoverage
    : {};
  const changes = [];
  let totalFields = 0;
  let omittedRows = 0;
  let omittedFields = 0;

  for (const collection of AUDITED_COLLECTIONS) {
    const previous = mapRecords(currentData?.[collection]);
    const incoming = mapRecords(nextData?.[collection]);
    for (const id of new Set([...previous.keys(), ...incoming.keys()])) {
      const before = previous.get(id);
      const after = incoming.get(id);
      if (same(before, after)) continue;
      if (changes.length >= MAX_ROWS_PER_EVENT) {
        omittedRows += 1;
        continue;
      }
      const fields = [];
      const counters = { fields: 0, omittedFields: 0 };
      diffValues(before, after, '', fields, counters);
      const action = before === undefined ? 'added' : after === undefined ? 'removed' : 'updated';
      changes.push({ collection, id: id.slice(0, 160), action, fields });
      totalFields += counters.fields + counters.omittedFields;
      omittedFields += counters.omittedFields;
    }
  }
  if (!changes.length && !omittedRows) {
    const { retained, activityCoverage } = retainActivity(prior, priorCoverage, null, at);
    return { ...nextData, ledgerActivity: retained, ledgerActivityCoverage: activityCoverage };
  }

  const entry = {
    id: crypto.randomUUID(),
    revision: Number.isInteger(revision) ? revision : null,
    at,
    actor: String(actor || 'System').slice(0, 160),
    changeCount: changes.length + omittedRows,
    fieldCount: totalFields,
    omittedRows,
    omittedFields,
    complete: omittedRows === 0 && omittedFields === 0,
    changes,
  };
  const bounded = boundedEvent(entry);
  const { retained, activityCoverage } = retainActivity(prior, priorCoverage, bounded, at);
  return { ...nextData, ledgerActivity: retained, ledgerActivityCoverage: activityCoverage };
}

module.exports = {
  AUDITED_COLLECTIONS,
  MAX_ACTIVITY_BYTES,
  MAX_ACTIVITY_EVENTS,
  MAX_EVENT_BYTES,
  createLedgerActivity,
};
