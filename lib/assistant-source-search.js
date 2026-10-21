const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');

const TEXT_EXTENSIONS = new Set(['.csv', '.txt', '.md', '.json', '.xml', '.html', '.htm', '.rtf']);
const MEDIA_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);
const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...MEDIA_EXTENSIONS, '.docx', '.xlsx']);
const SKIPPED_DIRECTORY_NAMES = new Set(['.git', 'node_modules', 'local backups', 'system volume information', '$recycle.bin']);
const SENSITIVE_NAME = /(?:^|[._\s-])(?:\.env|credentials?|secrets?|passwords?|tokens?|private[-_\s]?keys?)(?:$|[._\s-])/i;
const STOP_WORDS = new Set(['about', 'after', 'also', 'find', 'from', 'into', 'please', 'search', 'show', 'through', 'with', 'within']);

const normalizeText = value => String(value || '')
  .replace(/\0/g, ' ')
  .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const queryTerms = query => {
  const words = normalizeText(query).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._/-]*/gu) || [];
  const useful = [...new Set(words.filter(word => word.length > 1 && !STOP_WORDS.has(word)))];
  return useful.length ? useful : [...new Set(words.filter(word => word.length > 1))];
};

const decodeText = buffer => {
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  return buffer.toString('latin1');
};

async function extractDocumentText(filePath, buffer) {
  const extension = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) {
    const text = decodeText(buffer);
    return extension === '.html' || extension === '.htm'
      ? text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
      : text;
  }
  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  if (extension === '.xlsx') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const output = [];
    workbook.eachSheet((sheet, sheetId) => {
      if (sheetId > 20) return;
      output.push(`Sheet: ${sheet.name}`);
      const maxRow = Math.min(sheet.rowCount, 1000);
      const maxColumn = Math.min(sheet.columnCount, 60);
      for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
        const values = [];
        for (let column = 1; column <= maxColumn; column += 1) {
          const cell = sheet.getRow(rowNumber).getCell(column);
          const value = cell.text ?? cell.value;
          if (value !== null && value !== undefined && String(value).trim()) values.push(String(value).trim());
        }
        if (values.length) output.push(values.join(' | '));
      }
    });
    return output.join('\n');
  }
  if (extension === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      return (await parser.getText()).text || '';
    } finally {
      await parser.destroy();
    }
  }
  return '';
}

function scoreText(name, text, terms) {
  const filename = name.toLowerCase();
  const searchable = text.toLowerCase();
  let score = 0;
  let matchedTerms = 0;
  for (const term of terms) {
    const inFilename = filename.includes(term);
    const inContent = searchable.includes(term);
    if (inFilename || inContent) matchedTerms += 1;
    if (inFilename) score += 5;
    if (inContent) score += 1;
  }
  return { score, matchedTerms };
}

function makeExcerpt(text, terms, maxLength = 620) {
  const normalized = normalizeText(text);
  const lower = normalized.toLowerCase();
  const positions = terms.map(term => lower.indexOf(term)).filter(index => index >= 0);
  if (!positions.length) return '';
  const start = Math.max(0, Math.min(...positions) - 180);
  const excerpt = normalized.slice(start, start + maxLength);
  return `${start ? '…' : ''}${excerpt}${start + maxLength < normalized.length ? '…' : ''}`;
}

async function searchSourceFiles({
  roots,
  query,
  maxFiles = 2500,
  maxTotalBytes = 128 * 1024 * 1024,
  maxFileBytes = 8 * 1024 * 1024,
  maxResults = 12,
}) {
  const terms = queryTerms(query);
  if (!terms.length) throw new Error('Enter at least one searchable word or document number.');

  const files = [];
  const scanErrors = [];
  const rootPaths = roots.map(root => path.resolve(root)).filter(root => fs.existsSync(root));
  for (const root of rootPaths) {
    const stack = [root];
    while (stack.length && files.length < maxFiles) {
      const directory = stack.pop();
      let entries;
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true });
      } catch (error) {
        scanErrors.push(`${path.basename(directory)}: ${String(error.message || error).slice(0, 180)}`);
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && !SENSITIVE_NAME.test(entry.name) && !SKIPPED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) {
            stack.push(path.join(directory, entry.name));
          }
          continue;
        }
        if (!entry.isFile() || entry.name.startsWith('.') || SENSITIVE_NAME.test(entry.name)) continue;
        const extension = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(extension)) continue;
        const filePath = path.join(directory, entry.name);
        try {
          const stat = await fs.promises.stat(filePath);
          files.push({
            path: filePath,
            root,
            name: entry.name,
            extension,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          });
          if (files.length >= maxFiles) break;
        } catch (error) {
          scanErrors.push(`${entry.name}: ${String(error.message || error).slice(0, 180)}`);
          continue;
        }
      }
    }
    if (files.length >= maxFiles) break;
  }

  files.sort((a, b) => {
    const aName = scoreText(a.name, '', terms).score;
    const bName = scoreText(b.name, '', terms).score;
    return bName - aName || b.modifiedAt.localeCompare(a.modifiedAt);
  });

  const matches = [];
  const errors = [];
  let bytesRead = 0;
  let filesSearched = 0;
  let oversizedFiles = 0;
  let filesSkippedByTotalLimit = 0;
  let unsupportedContent = 0;
  let totalLimitReached = false;
  for (const file of files) {
    const filenameScore = scoreText(file.name, '', terms);
    if (file.size > maxFileBytes) {
      oversizedFiles += 1;
      if (filenameScore.score) {
        matches.push({
          ...file,
          text: '',
          excerpt: '',
          score: filenameScore.score,
          filenameOnly: true,
          canReview: MEDIA_EXTENSIONS.has(file.extension) && file.size <= maxFileBytes,
        });
      }
      continue;
    }
    if (bytesRead + file.size > maxTotalBytes) {
      filesSkippedByTotalLimit += 1;
      totalLimitReached = true;
      continue;
    }
    let buffer;
    let sourceHash = '';
    try {
      buffer = await fs.promises.readFile(file.path);
      bytesRead += buffer.length;
      filesSearched += 1;
      sourceHash = crypto.createHash('sha256').update(buffer).digest('hex');
      const text = normalizeText(await extractDocumentText(file.path, buffer)).slice(0, 12000);
      const { score, matchedTerms } = scoreText(file.name, text, terms);
      if (!score || !matchedTerms) {
        if (!text && MEDIA_EXTENSIONS.has(file.extension)) unsupportedContent += 1;
        continue;
      }
      matches.push({
        ...file,
        sourceHash,
        text,
        excerpt: makeExcerpt(text, terms),
        score,
        filenameOnly: !text,
        canReview: MEDIA_EXTENSIONS.has(file.extension) && file.size <= maxFileBytes || Boolean(text),
      });
    } catch (error) {
      errors.push(`${file.name}: ${String(error.message || error).slice(0, 180)}`);
      if (MEDIA_EXTENSIONS.has(file.extension)) unsupportedContent += 1;
      if (filenameScore.score && MEDIA_EXTENSIONS.has(file.extension)) {
        matches.push({
          ...file,
          ...(sourceHash ? { sourceHash } : {}),
          text: '',
          excerpt: '',
          score: filenameScore.score,
          filenameOnly: true,
          canReview: Boolean(sourceHash && file.size <= maxFileBytes),
        });
      }
    }
  }

  matches.sort((a, b) => b.score - a.score || b.modifiedAt.localeCompare(a.modifiedAt));
  const truncated = files.length >= maxFiles || totalLimitReached;
  return {
    matches: matches.slice(0, maxResults),
    coverage: {
      filesFound: files.length,
      filesSearched,
      bytesRead,
      truncated,
      oversizedFiles,
      filesSkippedByTotalLimit,
      imageOnlyOrUnreadableFiles: unsupportedContent,
      errors: errors.slice(0, 8),
      scanErrors: scanErrors.slice(0, 8),
    },
    terms,
  };
}

module.exports = { searchSourceFiles, extractDocumentText, queryTerms };
