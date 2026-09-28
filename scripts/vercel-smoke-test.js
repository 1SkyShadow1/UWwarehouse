const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const dataRoot = path.join(os.tmpdir(), `uw-vercel-smoke-${process.pid}`);
process.env.VERCEL = '1';
process.env.NODE_ENV = 'test';
process.env.UW_DATA_DIR = dataRoot;
process.env.UW_DOCUMENTS_DIR = path.join(dataRoot, 'documents');
process.env.UW_DB_FILE = path.join(dataRoot, 'uw-state.json');
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

const app = require('../server');
const server = app.server;

assert.equal(server, null, 'Vercel mode must export the app without opening a persistent listener.');

const testServer = http.createServer(app);
testServer.listen(0, '127.0.0.1', async () => {
  const address = testServer.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const [home, health, favicon, browserData, manifest, serviceWorker] = await Promise.all([
      fetch(base),
      fetch(`${base}/api/health`),
      fetch(`${base}/favicon.ico`),
      fetch(`${base}/imported-data.js`),
      fetch(`${base}/manifest.webmanifest`),
      fetch(`${base}/sw.js`),
    ]);
    assert.equal(home.status, 200, 'The root page must be served.');
    assert.match(await home.text(), /UW Accounting System/, 'The root response must contain the app.');
    assert.equal(health.status, 200, 'The health endpoint must be served.');
    assert.equal((await health.json()).ok, true, 'The health endpoint must return its success payload.');
    assert.equal(favicon.status, 200, 'The favicon route must be served.');
    assert.match(favicon.headers.get('content-type') || '', /^image\/png/, 'The favicon must be a PNG.');
    assert.equal(browserData.status, 200, 'Browser data scripts must be served.');
    assert.equal(manifest.status, 200, 'The PWA manifest must be served.');
    assert.equal(serviceWorker.status, 200, 'The service worker must be served.');
    console.log('Vercel function entrypoint smoke test passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    testServer.close(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  }
});
