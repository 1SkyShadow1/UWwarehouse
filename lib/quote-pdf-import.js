const { PDFParse } = require('pdf-parse');
const { quoteDateFromNumber } = require('./quote-date-from-number');

const MIME_TYPE = 'application/pdf';
const MAX_QUOTE_PDF_PAGES = 20;

class QuotePdfImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuotePdfImportError';
    this.statusCode = 422;
  }
}

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function validDate(value, label) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  let result;
  if (match) result = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  else {
    match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (match) result = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }
  if (!result || !Number.isFinite(Date.parse(`${result}T00:00:00Z`)) ||
      new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) {
    throw new QuotePdfImportError(`${label} is missing or is not a valid date in the quote PDF.`);
  }
  return result;
}

function amount(value, label) {
  const cleaned = String(value || '').replace(/[^\d,.-]/g, '').replace(/,/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    throw new QuotePdfImportError(`${label} is missing or unreadable in the quote PDF.`);
  }
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) throw new QuotePdfImportError(`${label} is not a valid number in the quote PDF.`);
  return parsed;
}

function isNumberToken(value) {
  return /^\d+(?:,\d{3})*(?:\.\d+)?$/.test(String(value || '').trim());
}

function findLabel(items, label) {
  const expected = normalizedText(label);
  return items.find(item => normalizedText(item.str).replace(/:$/, '') === expected);
}

function valueAfterLabel(items, label, maxX = Infinity) {
  const marker = findLabel(items, label);
  if (!marker) return '';
  const candidates = items
    .filter(item => Math.abs(item.y - marker.y) <= 3 && item.x >= marker.x + marker.width - 1 && item.x <= maxX && item !== marker)
    .sort((a, b) => a.x - b.x);
  return candidates.map(item => item.str.trim()).filter(Boolean).join(' ').trim();
}

function extractTableItems(pages) {
  const items = [];
  for (const page of pages) {
    const descriptionHeader = findLabel(page, 'Description');
    const quantityHeader = findLabel(page, 'Qty') || findLabel(page, 'Quantity');
    const unitHeader = page.find(item => normalizedText(item.str).includes('unit price'));
    const totalHeader = page.find(item => normalizedText(item.str).includes('total price'));
    if (!descriptionHeader || !quantityHeader || !unitHeader || !totalHeader) continue;

    const quantityMin = quantityHeader.x - 30;
    const quantityMax = unitHeader.x - 20;
    const unitMin = unitHeader.x - 25;
    const totalMin = totalHeader.x - 65;
    const quantities = page.filter(item =>
      item.y > quantityHeader.y + 4 &&
      item.x >= quantityMin && item.x < quantityMax &&
      isNumberToken(item.str));

    for (const quantityCell of quantities) {
      const nearest = (minX, maxX) => page
        .filter(item => Math.abs(item.y - quantityCell.y) <= 3.5 &&
          item.x >= minX && item.x <= maxX && isNumberToken(item.str))
        .sort((a, b) => a.x - b.x);
      const unitCells = nearest(unitMin, totalMin - 1);
      const totalCells = nearest(totalMin, Infinity);
      const descriptions = page
        .filter(item => Math.abs(item.y - quantityCell.y) <= 3.5 &&
          item.x >= descriptionHeader.x && item.x < quantityMin)
        .sort((a, b) => a.x - b.x)
        .map(item => item.str.trim())
        .filter(Boolean);
      if (!descriptions.length || !unitCells.length || !totalCells.length) {
        throw new QuotePdfImportError('A quote line is incomplete or unreadable. Use a text-based PDF exported from the quote template or import the .xlsx workbook.');
      }

      const qty = amount(quantityCell.str, 'Line quantity');
      const price = amount(unitCells[unitCells.length - 1].str, 'Line unit price');
      const lineTotal = amount(totalCells[totalCells.length - 1].str, 'Line total');
      if (qty <= 0 || price < 0 || Math.abs(Math.round(qty * price * 100) / 100 - lineTotal) > 0.01) {
        throw new QuotePdfImportError('A quote line total does not match its quantity and unit price. Review the PDF before importing.');
      }
      items.push({ desc: descriptions.join(' ').replace(/\s+/g, ' ').trim(), qty, price });
    }
  }
  if (!items.length) {
    throw new QuotePdfImportError('No readable quote line items were found. Use a text-based PDF exported from the quote template or import the .xlsx workbook.');
  }
  return items;
}

async function parseQuotePdf(buffer, originalName = 'quote.pdf') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new QuotePdfImportError('The upload is not a valid PDF quote.');
  }
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    await parser.load();
    const pageCount = Number((await parser.getInfo()).total) || 0;
    if (!pageCount || pageCount > MAX_QUOTE_PDF_PAGES) {
      throw new QuotePdfImportError(`Quote PDFs must contain between 1 and ${MAX_QUOTE_PDF_PAGES} pages.`);
    }

    const pages = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await parser.doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push(content.items.filter(item => typeof item.str === 'string' && item.str.trim())
        .map(item => ({
          str: item.str.trim(),
          x: item.transform[4],
          y: viewport.height - item.transform[5],
          width: item.width,
        })));
    }

    const allItems = pages.flat();
    const text = allItems.map(item => item.str).join(' ');
    const quoteIdMatch = text.match(/\b((?:BB|SS)\d{8,})\b/i);
    if (!/\bquotation\b/i.test(text) || !/\bquote line items\b/i.test(text) ||
        !findLabel(allItems, 'Description') || !findLabel(allItems, 'Qty')) {
      throw new QuotePdfImportError('This PDF does not match the searchable UW quote layout. Import a PDF exported from the quote template or use the .xlsx workbook.');
    }
    if (!quoteIdMatch) throw new QuotePdfImportError('Quote number is missing or unreadable in the PDF.');

    const quoteId = quoteIdMatch[1].toUpperCase();
    const date = quoteDateFromNumber(quoteId);
    if (!date) throw new QuotePdfImportError('Quote number must contain a valid DDMMYY date and daily sequence.');

    const customer = valueAfterLabel(allItems, 'Client account name', 260);

    const items = extractTableItems(pages);
    const computedTotal = Math.round(items.reduce((sum, item) => sum + item.qty * item.price, 0) * 100) / 100;
    const totalLabel = allItems.find(item => normalizedText(item.str).includes('*total'));
    if (!totalLabel) throw new QuotePdfImportError('The quote grand total is missing from the PDF.');
    const printedTotal = allItems
      .filter(item => Math.abs(item.y - totalLabel.y) <= 3 && item.x > totalLabel.x && isNumberToken(item.str))
      .sort((a, b) => a.x - b.x)
      .pop();
    if (!printedTotal || Math.abs(amount(printedTotal.str, 'Quote grand total') - computedTotal) > 0.01) {
      throw new QuotePdfImportError('The quote grand total does not match the line items. Review the PDF before importing.');
    }

    const introLabel = findLabel(allItems, 'Introduction, notes and specifications');
    const lineItemsLabel = findLabel(allItems, 'Quote line items');
    const introduction = introLabel && lineItemsLabel
      ? allItems.filter(item => item.y > introLabel.y + 3 && item.y < lineItemsLabel.y - 3 && item.x < 520)
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map(item => item.str.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
      : '';
    const expiryText = valueAfterLabel(allItems, 'Expiry date');
    const quote = {
      id: quoteId,
      date,
      expiry: expiryText ? validDate(expiryText.replace(/[^\d./-]/g, ''), 'Expiry date') : '',
      customer,
      contact: valueAfterLabel(allItems, 'Client contact name', 260),
      phone: valueAfterLabel(allItems, 'Client telephone', 260),
      email: valueAfterLabel(allItems, 'Client email', 260),
      billingAddress: valueAfterLabel(allItems, 'Billing address', 260),
      preparedBy: valueAfterLabel(allItems, 'Prepared by'),
      projectReference: valueAfterLabel(allItems, 'Project Reference', 260),
      workType: 'Reupholster',
      colour: '',
      introduction,
      notes: introduction,
      items,
      sourceTotal: computedTotal,
      sourcePdfName: originalName,
      status: 'Draft',
      reviewStatus: 'Needs review',
      includedInTotals: false,
      terms: true,
    };
    if (quote.expiry && quote.expiry < quote.date) {
      throw new QuotePdfImportError('Expiry date is earlier than the quote date.');
    }
    return quote;
  } catch (error) {
    if (error instanceof QuotePdfImportError) throw error;
    throw new QuotePdfImportError(`The PDF quote could not be read. Use a searchable PDF exported from the quote template, or import the .xlsx workbook. (${error.message})`);
  } finally {
    await parser.destroy();
  }
}

module.exports = { MIME_TYPE, MAX_QUOTE_PDF_PAGES, QuotePdfImportError, parseQuotePdf };
