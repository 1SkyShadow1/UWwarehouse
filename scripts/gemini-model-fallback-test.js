const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const startServer = async mode => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), `uw-gemini-${mode}-`));
  const preloadPath = path.join(dataRoot, 'mock-gemini.js');
  const requestLogPath = path.join(dataRoot, 'models.jsonl');
  const port = 50000 + Math.floor(Math.random() * 10000);
  const base = `http://127.0.0.1:${port}`;
  const apiKey = 'gemini-fallback-test-key';
  const sourcePath = path.join(dataRoot, 'receipt.png');
  fs.writeFileSync(sourcePath, Buffer.from('test-image'));
  fs.writeFileSync(preloadPath, `
    const fs = require('node:fs');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.hostname !== 'generativelanguage.googleapis.com') return originalFetch(input, init);
      const model = decodeURIComponent(url.pathname.split('/').at(-1).split(':')[0]);
      const body = JSON.parse(init.body);
      const hasInlineData = body.contents.some(content => content.parts.some(part => part.inline_data));
      const prompt = body.contents.flatMap(content => content.parts).map(part => part.text || '').join(' ');
      fs.appendFileSync(process.env.GEMINI_TEST_MODEL_LOG, JSON.stringify({ model, hasInlineData, prompt }) + '\\n');
      if (prompt.includes('invalid-request-test')) {
        return new Response(JSON.stringify({
          error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid request for test.' }
        }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      if (prompt.includes('billing-error-test')) {
        return new Response(JSON.stringify({
          error: { code: 403, status: 'PERMISSION_DENIED', message: 'Quota exceeded because billing is disabled.' }
        }), { status: 403, headers: { 'content-type': 'application/json' } });
      }
      if (model === 'gemini-3.6-flash') {
        return new Response(JSON.stringify({
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            message: 'Quota exceeded for requests per minute',
            details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '60s' }]
          }
        }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } });
      }
      const text = hasInlineData
        ? JSON.stringify({
            documentDate: '2026-09-28',
            merchant: 'Test Merchant',
            amountPaid: process.env.GEMINI_TEST_MODE === 'missing-amount' ? null : 123.45,
            currency: 'ZAR',
            documentType: 'receipt',
            invoiceNumber: 'TEST-1',
            confidence: 0.99,
            notes: ''
          })
        : 'Gemini fallback succeeded.';
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text }] } }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  `);

  const child = spawn(process.execPath, ['-r', preloadPath, path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      UW_DATA_DIR: path.join(dataRoot, 'data'),
      UW_DOCUMENTS_DIR: path.join(dataRoot, 'data', 'documents'),
      UW_SOURCE_DIR: dataRoot,
      UW_API_KEY: apiKey,
      UW_AUTH_USERS_JSON: '{}',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      GEMINI_API_KEY: 'test-key-not-a-real-credential',
      GEMINI_MODEL: 'gemini-3.6-flash',
      GEMINI_TEST_MODEL_LOG: requestLogPath,
      GEMINI_TEST_MODE: mode,
      UW_LOCAL_ONLY: ['local-document-review', 'missing-key'].includes(mode) ? '1' : '0',
      ...(mode === 'missing-key' ? { GEMINI_API_KEY: '' } : {}),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  const request = (route, body) => fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  });

  try {
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Server exited during startup.${stderr ? `\n${stderr}` : ''}`);
      try {
        const response = await fetch(`${base}/api/health`);
        if (response.ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, `Server did not become ready.${stderr ? `\n${stderr}` : ''}`);
    return { base, child, dataRoot, request, requestLogPath, sourcePath, stderr: () => stderr };
  } catch (error) {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(dataRoot, { recursive: true, force: true });
    throw error;
  }
};

const stopServer = async server => {
  server.child.kill();
  await new Promise(resolve => server.child.once('exit', resolve));
  fs.rmSync(server.dataRoot, { recursive: true, force: true });
};

const readModelRequests = server => fs.readFileSync(server.requestLogPath, 'utf8')
  .trim().split(/\r?\n/).map(line => JSON.parse(line));

const runChatFallbackTest = async () => {
  const server = await startServer('chat');
  try {
    const firstResponse = await server.request('/api/ai/generate', { prompt: 'Summarize the current test.' });
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    assert.equal(first.model, 'gemini-flash-latest');
    assert.equal(first.text, 'Gemini fallback succeeded.');

    const secondResponse = await server.request('/api/ai/generate', { prompt: 'Summarize the current test again.' });
    assert.equal(secondResponse.status, 200);
    const second = await secondResponse.json();
    assert.equal(second.model, 'gemini-flash-latest');

    const invalidResponse = await server.request('/api/ai/generate', { prompt: 'invalid-request-test' });
    assert.equal(invalidResponse.status, 400, 'A malformed Gemini request should not fail over to another model.');

    const billingResponse = await server.request('/api/ai/generate', { prompt: 'billing-error-test' });
    assert.equal(billingResponse.status, 403, 'Billing and permission errors should not fail over to another model.');

    const requests = readModelRequests(server);
    assert.deepEqual(requests.map(item => item.model), [
      'gemini-3.6-flash',
      'gemini-flash-latest',
      'gemini-flash-latest',
      'gemini-flash-latest',
      'gemini-flash-latest',
    ]);
    console.log('Gemini chat falls back on quota exhaustion, honors cooldowns, and does not fail over on invalid requests.');
  } finally {
    await stopServer(server);
  }
};

const runDocumentReviewFallbackTest = async () => {
  const server = await startServer('local-document-review');
  try {
    const body = { name: 'receipt.png', path: server.sourcePath };
    const firstResponse = await server.request('/api/ai/review-document', body);
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    assert.equal(first.model, 'gemini-flash-latest');
    assert.equal(first.merchant, 'Test Merchant');
    assert.equal(first.amountPaid, 123.45);
    const config = await (await fetch(server.base + '/api/ai/config')).json();
    assert.equal(config.configured, true, 'Local storage must retain the configured Gemini review integration');
    const health = await (await fetch(server.base + '/api/health')).json();
    assert.equal(health.localOnly, true);
    assert.equal(health.supabaseConfigured, false);

    const secondResponse = await server.request('/api/ai/review-document', body);
    assert.equal(secondResponse.status, 200);
    const second = await secondResponse.json();
    assert.equal(second.model, 'gemini-flash-latest');

    const requests = readModelRequests(server);
    assert.deepEqual(requests.map(item => item.model), [
      'gemini-3.6-flash',
      'gemini-flash-latest',
      'gemini-flash-latest',
    ]);
    assert.ok(requests.every(item => item.hasInlineData), 'Receipt-review requests must retain the source image when switching models.');
    console.log('Gemini receipt review falls back on quota exhaustion and retains the document bytes.');
  } finally {
    await stopServer(server);
  }
};

const runReviewErrorTests = async () => {
  for (const mode of ['missing-key', 'missing-amount']) {
    const server = await startServer(mode);
    try {
      const response = await server.request('/api/ai/review-document', {name:'receipt.png',path:server.sourcePath});
      const result = await response.json();
      if (mode === 'missing-key') {
        assert.equal(response.status, 503);
        assert.equal(result.code, 'AI_NOT_CONFIGURED');
        assert.equal(result.retryable, false);
        assert.equal(fs.existsSync(server.requestLogPath), false, 'No provider request without a key');
      } else {
        assert.equal(response.status, 200);
        assert.equal(result.amountPaid, null, 'An unreadable total must not become a zero amount');
      }
    } finally { await stopServer(server); }
  }
  console.log('Unconfigured review fails once; unreadable receipt amounts remain blank.');
};

runChatFallbackTest()
  .then(runDocumentReviewFallbackTest)
  .then(runReviewErrorTests)
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
