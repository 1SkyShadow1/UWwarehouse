const ExcelJS = require('exceljs');

const MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

class QuoteImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuoteImportError';
    this.statusCode = 422;
  }
}

function cellValue(sheet, address) {
  const value = sheet.getCell(address).value;
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'result') && value.result !== null && value.result !== undefined) {
    return value.result;
  }
  return value;
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('').trim();
    if (value.text !== undefined) return String(value.text).trim();
    if (value.result !== undefined) return cellText(value.result);
    if (value.formula) return '';
  }
  return String(value).trim();
}

function readCell(sheet, row, column) {
  return cellText(cellValue(sheet, `${column}${row}`));
}

function normalizeLabel(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeDate(value, label) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const text = cellText(value);
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (match) {
    const result = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    if (isValidDate(result)) return result;
  }
  match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (match) {
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    const result = `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    if (isValidDate(result)) return result;
  }
  throw new QuoteImportError(`${label} is missing or not a valid date. Enter it as a spreadsheet date or DD/MM/YYYY.`);
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseAmount(value, label, { allowFormula = false } = {}) {
  if (value && typeof value === 'object') {
    if (typeof value.result === 'number' && Number.isFinite(value.result)) return value.result;
    if (allowFormula && typeof value.formula === 'string') return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = cellText(value).replace(/^R\s*/i, '').replace(/[\s,]/g, '');
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) {
    throw new QuoteImportError(`${label} is missing or is not a valid number. Enter the amount explicitly in the workbook.`);
  }
  const amount = Number(text);
  if (!Number.isFinite(amount)) throw new QuoteImportError(`${label} must be a finite number.`);
  return amount;
}

function sheetHasQuoteTemplate(sheet) {
  const values = [];
  sheet.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
    values.push(normalizeLabel(cellText(cell.value)));
  }));
  const content = values.join('|');
  return content.includes('quotation') &&
    content.includes('client account name') &&
    content.includes('quote number') &&
    content.includes('project reference') &&
    content.includes('introduction notes and specifications') &&
    content.includes('unit price') &&
    content.includes('total price');
}

function findLabelRow(sheet, label) {
  const target = normalizeLabel(label);
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      if (normalizeLabel(readCell(sheet, row, sheet.getColumn(column).letter)).includes(target)) return row;
    }
  }
  return 0;
}

function valueBesideLabel(sheet, row, valueColumns) {
  for (const column of valueColumns) {
    const text = readCell(sheet, row, column);
    if (text) return text;
  }
  return '';
}

function readDescriptions(sheet, startRow, endRow) {
  const lines = [];
  for (let row = startRow; row <= endRow; row += 1) {
    const values = ['B', 'C', 'D', 'E', 'F'].map(column => readCell(sheet, row, column)).filter(Boolean);
    const text = [...new Set(values)].join(' ').trim();
    if (text) lines.push(text);
  }
  return lines;
}

function findLineTable(sheet) {
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    const labels = ['B', 'C', 'D', 'E', 'F'].map(column => normalizeLabel(readCell(sheet, row, column)));
    if (labels.some(label => label === 'description') &&
        labels.some(label => label === 'qty' || label === 'quantity') &&
        labels.some(label => label.includes('unit price')) &&
        labels.some(label => label.includes('total price'))) return row;
  }
  throw new QuoteImportError('Quote line-item headings were not found. Use the current Quote Template.xlsx layout.');
}

async function parseQuoteWorkbook(buffer, originalName = 'quote.xlsx') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.subarray(0, 2).toString('ascii') !== 'PK') {
    throw new QuoteImportError('The upload is not a valid .xlsx workbook. Choose an Excel quote workbook and try again.');
  }
  const workbook = new ExcelJS.Workbook();
  return workbook.xlsx.load(buffer).then(() => {
    const sheet = workbook.worksheets.find(sheetHasQuoteTemplate);
    if (!sheet) throw new QuoteImportError('This workbook does not match the current quote template. Use the supplied Quote Template.xlsx layout.');

    const quoteId = readCell(sheet, 5, 'F');
    const dateValue = cellValue(sheet, 'F6');
    const date = normalizeDate(dateValue, 'Date generated');
    const customer = readCell(sheet, 5, 'C');
    if (!customer) throw new QuoteImportError('Client account name is required. Fill in the customer name in the workbook.');
    if (!quoteId) throw new QuoteImportError('Quote number is required. Fill in the quote number in the workbook.');
    const expectedDateKey = date.slice(8, 10) + date.slice(5, 7) + date.slice(2, 4);
    if (!/^(BB|SS)\d{6}\d{2,}$/.test(quoteId) || quoteId.slice(2, 8) !== expectedDateKey || Number(quoteId.slice(8)) < 1) {
      throw new QuoteImportError('Quote number must use BB or SS + DDMMYY + daily sequence and match the quote date (for example BB07112601).');
    }

    const expiryValue = cellValue(sheet, 'F7');
    const expiry = expiryValue === null || expiryValue === undefined || !cellText(expiryValue)
      ? ''
      : normalizeDate(expiryValue, 'Expiry date');
    if (expiry && expiry < date) throw new QuoteImportError('Expiry date must be on or after the quote date.');

    const tableRow = findLineTable(sheet);
    const totalRow = (() => {
      for (let row = tableRow + 1; row <= sheet.rowCount; row += 1) {
        const label = normalizeLabel(readCell(sheet, row, 'B') || readCell(sheet, row, 'C'));
        if (label.startsWith('total')) return row;
        if (label.includes('acceptance of quotation')) break;
      }
      return 0;
    })();
    if (!totalRow) throw new QuoteImportError('The quote grand-total row is missing. Restore the total row in the workbook before importing.');

    const items = [];
    for (let row = tableRow + 1; row < totalRow; row += 1) {
      const desc = readCell(sheet, row, 'B') || readCell(sheet, row, 'C');
      const qtyValue = cellValue(sheet, `D${row}`);
      const priceValue = cellValue(sheet, `E${row}`);
      const lineTotalValue = cellValue(sheet, `F${row}`);
      if (!desc && !cellText(qtyValue) && !cellText(priceValue) && !cellText(lineTotalValue)) continue;
      if (!desc) throw new QuoteImportError(`Line ${row - tableRow} is missing its description. Complete or remove that row.`);
      const qty = parseAmount(qtyValue, `Quantity on line ${row - tableRow}`);
      const price = parseAmount(priceValue, `Unit price on line ${row - tableRow}`);
      if (qty <= 0) throw new QuoteImportError(`Quantity on line ${row - tableRow} must be greater than zero.`);
      if (price < 0) throw new QuoteImportError(`Unit price on line ${row - tableRow} cannot be negative.`);
      const computedTotal = Math.round(qty * price * 100) / 100;
      const rawLineTotal = cellValue(sheet, `F${row}`);
      const lineTotal = parseAmount(lineTotalValue, `Line total on line ${row - tableRow}`, { allowFormula: true });
      if (lineTotal === null && rawLineTotal?.formula) {
        const formula = String(rawLineTotal.formula).replace(/[\s$=]/g, '').toUpperCase();
        if (![`E${row}*D${row}`, `D${row}*E${row}`].includes(formula)) {
          throw new QuoteImportError(`Line total formula on line ${row - tableRow} is not a standard quantity × unit-price calculation.`);
        }
      }
      if (lineTotal !== null && Math.abs(lineTotal - computedTotal) > 0.01) {
        throw new QuoteImportError(`Line total on line ${row - tableRow} does not match quantity × unit price. Correct the workbook before importing.`);
      }
      items.push({ desc, qty, price });
    }
    if (!items.length) throw new QuoteImportError('At least one complete quote line item is required.');

    const totalValue = cellValue(sheet, `F${totalRow}`);
    const sourceTotal = parseAmount(totalValue, 'Quote grand total', { allowFormula: true });
    const computedTotal = Math.round(items.reduce((sum, item) => sum + item.qty * item.price, 0) * 100) / 100;
    if (sourceTotal === null && totalValue?.formula) {
      const formula = String(totalValue.formula).replace(/[\s$=]/g, '').toUpperCase();
      if (formula !== `SUM(F${tableRow + 1}:F${totalRow - 1})`) {
        throw new QuoteImportError('Quote grand total formula is not a standard sum of the quote line totals. Correct the workbook before importing.');
      }
    }
    if (sourceTotal !== null && Math.abs(sourceTotal - computedTotal) > 0.01) {
      throw new QuoteImportError(`Quote grand total (${sourceTotal.toFixed(2)}) does not match the line-item total (${computedTotal.toFixed(2)}). Correct the workbook before importing.`);
    }

    const notesStart = findLabelRow(sheet, 'Introduction, notes and specifications');
    const notes = notesStart ? readDescriptions(sheet, notesStart + 1, tableRow - 1).join('\n') : '';
    const projectRow = findLabelRow(sheet, 'Project Reference');
    const projectReference = projectRow ? valueBesideLabel(sheet, projectRow, ['C', 'D', 'E', 'F']) : '';
    const termsStart = findLabelRow(sheet, 'Acceptance of quotation and official order');
    const termsEnd = findLabelRow(sheet, 'Payment Details: COD or EFT') || findLabelRow(sheet, 'Client Name:');
    const sourceTerms = termsStart && termsEnd > termsStart
      ? readDescriptions(sheet, termsStart + 1, termsEnd - 1)
      : [];
    const billingAddress = readCell(sheet, 9, 'C');
    return {
      id: quoteId,
      date,
      expiry,
      customer,
      contact: readCell(sheet, 6, 'C'),
      phone: readCell(sheet, 7, 'C'),
      email: readCell(sheet, 8, 'C'),
      billingAddress,
      preparedBy: readCell(sheet, 8, 'F'),
      projectReference,
      workType: 'Reupholster',
      colour: '',
      introduction: notes,
      notes,
      sourceTerms,
      items,
      sourceTotal: computedTotal,
      sourceWorkbookName: originalName,
      status: 'Draft',
      reviewStatus: 'Needs review',
      includedInTotals: false,
      terms: true,
    };
  }).catch(error => {
    if (error instanceof QuoteImportError) throw error;
    throw new QuoteImportError(`The workbook could not be read. Save it as a standard .xlsx file and retry. (${error.message})`);
  });
}

module.exports = { MIME_TYPE, QuoteImportError, parseQuoteWorkbook };
