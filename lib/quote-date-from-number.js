function quoteDateFromNumber(quoteNumber) {
  const match = String(quoteNumber || '').match(/^(?:BB|SS)(\d{2})(\d{2})(\d{2})(\d{2,})$/i);
  if (!match || Number(match[4]) < 1) return '';
  const date = `20${match[3]}-${match[2]}-${match[1]}`;
  if (!Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return '';
  return date;
}

module.exports = { quoteDateFromNumber };
