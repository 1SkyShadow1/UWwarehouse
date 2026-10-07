const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const port = 50000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${port}`;
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uw-persistence-'));
const invoicesRoot = path.join(dataRoot, 'saved-invoices');
const quotesRoot = path.join(dataRoot, 'saved-quotes');
const sourceRoot = path.join(dataRoot, 'reference-files');
const referencePath = path.join(sourceRoot, 'finance-note.txt');
const apiKey = 'persistence-test-api-key';
fs.mkdirSync(sourceRoot, { recursive: true });
fs.writeFileSync(referencePath, 'Accessible through configured absolute source paths.');
const env = {
  ...process.env,
  PORT: String(port),
  HOST: '127.0.0.1',
  NODE_ENV: 'test',
  UW_DATA_DIR: path.join(dataRoot, 'state'),
  UW_DOCUMENTS_DIR: path.join(dataRoot, 'state', 'documents'),
  UW_INVOICES_DIR: invoicesRoot,
  UW_QUOTES_DIR: quotesRoot,
  UW_SOURCE_DIR: sourceRoot,
  UW_API_KEY: apiKey,
  UW_AUTH_USERS_JSON: '{}',
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
};
const request = (route, options = {}) => fetch(`${base}${route}`, {
  ...options,
  headers: {
    'x-api-key': apiKey,
    ...(options.headers || {}),
  },
});
let child;

const startServer = () => {
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let serverError = '';
  child.stderr.on('data', chunk => { serverError += chunk.toString(); });
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30000;
    const poll = async () => {
      if (child.exitCode !== null) {
        reject(new Error(`Server exited during startup.${serverError ? `\n${serverError}` : ''}`));
        return;
      }
      try {
        const response = await request('/api/health');
        if (response.ok) {
          resolve();
          return;
        }
      } catch {}
      if (Date.now() >= deadline) {
        reject(new Error(`Server did not become ready.${serverError ? `\n${serverError}` : ''}`));
        return;
      }
      setTimeout(poll, 100);
    };
    poll();
  });
};
const stopServer = async () => {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise(resolve => child.once('exit', resolve));
};

const run = async () => {
  const invoice = {
    id: 'BB2026/09/2801',
    date: '2026-09-28',
    customer: 'Persistence Test',
    project: 'Test',
    items: [{ desc: 'Test item', qty: 1, price: 100 }],
  };
  const quote = {
    id: 'QU2026/09/2801',
    date: '2026-09-28',
    customer: 'Persistence Test',
    items: [{ desc: 'Test item', qty: 1, price: 100 }],
  };

  try {
    await startServer();
    const response = await request('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        revision: 0,
        data: { invoices: [invoice], quotes: [quote] },
      }),
    });
    assert.equal(response.status, 200, 'State save failed.');
    const saved = await response.json();
    assert.equal(saved.revision, 1);
    assert.deepEqual(saved.documentExports, { invoices: 1, quotes: 1, errors: [] });
    assert.ok(fs.statSync(path.join(invoicesRoot, 'invoice-BB2026-09-2801.pdf')).size > 500);
    assert.ok(fs.statSync(path.join(quotesRoot, 'quote-QU2026-09-2801.pdf')).size > 500);
    assert.ok(fs.existsSync(`${path.join(dataRoot, 'state', 'uw-state.json')}.bak`));
    const sourceResponse = await request(`/api/source-file?path=${encodeURIComponent(referencePath)}`);
    assert.equal(sourceResponse.status, 200);
    assert.equal(await sourceResponse.text(), 'Accessible through configured absolute source paths.');

    const updatedInvoice = { ...invoice, project: 'Updated after save', items: [{ desc: 'Updated item', qty: 2, price: 150 }] };
    const updateResponse = await request('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        revision: 1,
        data: { invoices: [updatedInvoice], quotes: [quote] },
      }),
    });
    assert.equal(updateResponse.status, 200, 'Updated state save failed.');
    const updated = await updateResponse.json();
    assert.equal(updated.revision, 2);
    assert.deepEqual(updated.documentExports, { invoices: 1, quotes: 0, errors: [] });
    assert.ok(fs.statSync(path.join(invoicesRoot, 'invoice-BB2026-09-2801.pdf')).size > 500);

    await stopServer();
    await startServer();
    const restoredResponse = await request('/api/state');
    assert.equal(restoredResponse.status, 200);
    const restored = await restoredResponse.json();
    assert.equal(restored.revision, 2);
    assert.deepEqual(restored.data.invoices, [updatedInvoice]);
    assert.deepEqual(restored.data.quotes, [quote]);
    // A failed PDF export must preserve the ledger and retry even if an older PDF exists.
    const displacedRoot = `${invoicesRoot}-temporarily-unavailable`;
    fs.renameSync(invoicesRoot, displacedRoot);
    fs.writeFileSync(invoicesRoot, 'Simulated unavailable export directory');
    const finalInvoice = { ...updatedInvoice, project: 'Retry after folder recovery' };
    const put = async revision => {
      const response = await request('/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision, data: { invoices: [finalInvoice], quotes: [quote] } }) });
      assert.equal(response.status, 200, 'PDF errors must not lose the accounting save.');
      return response.json();
    };
    const failedExport = await put(2);
    assert.equal(failedExport.documentExports.errors.length, 1);
    fs.unlinkSync(invoicesRoot);
    fs.renameSync(displacedRoot, invoicesRoot);
    const retried = await put(3);
    assert.deepEqual(retried.documentExports, { invoices: 1, quotes: 0, errors: [] });
    fs.unlinkSync(path.join(quotesRoot, 'quote-QU2026-09-2801.pdf'));
    const recreated = await put(4);
    assert.deepEqual(recreated.documentExports, { invoices: 0, quotes: 1, errors: [] });
    console.log('State survives a server restart; updated invoice PDFs overwrite safely and quotes save separately.');
    console.log('Failed and missing document exports retry without losing the saved ledger.');
  } finally {
    await stopServer();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
