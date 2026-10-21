const FIELD_ALLOWLIST = Object.freeze({
  invoices: new Set(['date', 'dueDate', 'customer', 'project', 'orderNo']),
  quotes: new Set(['date', 'expiry', 'customer', 'projectReference']),
  expenses: new Set(['date', 'vendor', 'desc', 'amount', 'category']),
  payables: new Set(['date', 'dueDate', 'supplier', 'description', 'amount']),
  jobs: new Set(['customer', 'project', 'startDate', 'materialStatus']),
  stock: new Set(['quantity', 'reorderLevel']),
});

const NUMBER_FIELDS = new Set(['amount', 'quantity', 'reorderLevel']);
const DATE_FIELDS = new Set(['date', 'dueDate', 'expiry', 'startDate']);
const validDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const normalizeEvidence = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

function normalizeProposedValue(field, value) {
  if (DATE_FIELDS.has(field)) return validDate(value) ? value : null;
  if (NUMBER_FIELDS.has(field)) {
    const parsed = typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d{1,9}(?:\.\d{1,2})?$/.test(value.trim())
        ? Number(value)
        : NaN;
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100000000) return null;
    return Math.round((parsed + Number.EPSILON) * 100) / 100;
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 180 || /[<>"'`\\\u0000-\u001f]/.test(normalized)) return null;
  return normalized;
}

function validateAssistantProposals(proposals, records, selectedSources, maxProposals = 25) {
  if (!Array.isArray(proposals)) return [];
  const sourceById = new Map(selectedSources.map(source => [source.id, source]));
  const seen = new Set();
  const approved = [];

  for (const proposal of proposals.slice(0, 100)) {
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) continue;
    const collection = String(proposal.collection || '');
    const field = String(proposal.field || '');
    const recordId = String(proposal.recordId || '').slice(0, 160);
    const source = sourceById.get(String(proposal.sourceId || ''));
    if (!FIELD_ALLOWLIST[collection]?.has(field) || !recordId || !source?.text) continue;
    const record = (Array.isArray(records[collection]) ? records[collection] : [])
      .find(row => String(row?.id ?? '') === recordId);
    if (!record) continue;

    const evidence = String(proposal.evidence || '').trim().slice(0, 360);
    const normalizedEvidence = normalizeEvidence(evidence);
    if (normalizedEvidence.length < 8 || !normalizeEvidence(source.text).includes(normalizedEvidence)) continue;

    const value = normalizeProposedValue(field, proposal.value);
    if (value === null) continue;
    const key = `${collection}\n${recordId}\n${field}`;
    if (seen.has(key)) continue;
    if (Object.is(record[field], value)) continue;

    const confidence = Number(proposal.confidence);
    if (!Number.isFinite(confidence) || confidence < 0.75 || confidence > 1) continue;
    seen.add(key);
    approved.push({
      collection,
      recordId,
      field,
      currentValuePresent: Object.prototype.hasOwnProperty.call(record, field),
      currentValue: record[field] ?? null,
      value,
      reason: String(proposal.reason || '').trim().slice(0, 240),
      evidence,
      confidence,
      sourceId: source.id,
      sourceName: source.name,
      sourcePath: source.relativePath,
    });
    if (approved.length >= maxProposals) break;
  }
  return approved;
}

module.exports = { FIELD_ALLOWLIST, validateAssistantProposals };
