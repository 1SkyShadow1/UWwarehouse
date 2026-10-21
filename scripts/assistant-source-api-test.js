const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const startServer = async localOnly => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uw-assistant-api-'));
  const sourceRoot = path.join(tempRoot, 'UW');
  fs.mkdirSync(sourceRoot, { recursive: true });
  const sourcePath = path.join(sourceRoot, 'invoice.txt');
  fs.writeFileSync(sourcePath, 'Acme Upholstery reference INV-1 Amount 125.00');
  const imagePath = path.join(sourceRoot, 'Receipt-INV-2.jpg');
  const imageBytes = Buffer.from('fixture image bytes');
  fs.writeFileSync(imagePath, imageBytes);
  fs.writeFileSync(path.join(sourceRoot, 'unselected.txt'), 'UNSELECTED_SOURCE_CONTENT must not leave the local source folder.');
  const mockPath = path.join(tempRoot, 'mock-gemini.js');
  const requestLogPath = path.join(tempRoot, 'gemini-request.json');
  const port = 52000 + Math.floor(Math.random() * 10000);
  const apiKey = 'assistant-source-test-key';
  fs.writeFileSync(mockPath, `
    const fs = require('node:fs');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.hostname !== 'generativelanguage.googleapis.com') return originalFetch(input, init);
      const body = JSON.parse(init.body);
      fs.writeFileSync(process.env.ASSISTANT_SOURCE_GEMINI_LOG, JSON.stringify(body));
      const systemText = body.system_instruction.parts.map(part => part.text || '').join(' ');
      const sourceId = systemText.match(/"selectedSourceDocuments":\\[\\{"id":"([^"]+)"/)?.[1] || '';
      const text = JSON.stringify({
        summary: 'Source review completed.',
        transcriptions: [{ sourceId, text: 'Receipt INV-2 Acme Amount 125.00' }],
        updates: [
          { collection: 'expenses', recordId: 'E-1', field: 'amount', value: '125.00', reason: 'The source explicitly states this amount.', sourceId, evidence: 'Amount 125.00', confidence: 0.99 },
          { collection: 'invoices', recordId: 'I-1', field: 'paid', value: '999', reason: 'Disallowed payment field.', sourceId, evidence: 'Amount 125.00', confidence: 0.99 },
          { collection: 'expenses', recordId: 'E-1', field: 'amount', value: '150.00', reason: 'Evidence does not support this.', sourceId, evidence: 'Amount 150.00', confidence: 0.99 },
          { collection: 'expenses', recordId: 'MISSING', field: 'amount', value: '125.00', reason: 'Unknown record.', sourceId, evidence: 'Amount 125.00', confidence: 0.99 }
        ]
      });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  `);
  const child = spawn(process.execPath, ['-r', mockPath, path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      UW_LOCAL_ONLY: localOnly ? '1' : '0',
      UW_DATA_DIR: path.join(tempRoot, 'data'),
      UW_DOCUMENTS_DIR: path.join(tempRoot, 'data', 'documents'),
      UW_SOURCE_DIR: sourceRoot,
      UW_SOURCE_DIRS: '',
      UW_API_KEY: apiKey,
      UW_AUTH_USERS_JSON: '{}',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      GEMINI_API_KEY: 'test-key-not-a-real-credential',
      GEMINI_MODEL: 'gemini-3.6-flash',
      ASSISTANT_SOURCE_GEMINI_LOG: requestLogPath,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  let lastResponse = 'no HTTP response';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const base = `http://127.0.0.1:${port}`;
  const request = (route, body, method = 'POST') => fetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Server exited during startup.${stderr ? `\n${stderr}` : ''}`);
      try {
        const response = await fetch(`${base}/api/health`);
        lastResponse = `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`;
        if (response.ok) { ready = true; break; }
      } catch (error) { lastResponse = String(error.message || error); }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, `Server did not become ready (${lastResponse}).${stderr ? `\n${stderr}` : ''}`);
    return { base, child, tempRoot, sourcePath, imagePath, imageBytes, request, requestLogPath, stderr: () => stderr };
  } catch (error) {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
};

const stopServer = async server => {
  server.child.kill();
  await new Promise(resolve => server.child.once('exit', resolve));
  fs.rmSync(server.tempRoot, { recursive: true, force: true });
};

async function readJson(response) {
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`Expected JSON, received: ${text.slice(0, 300)}`); }
  return body;
}

async function runLocalReviewFlow() {
  const server = await startServer(true);
  try {
    const stateResponse = await server.request('/api/state', undefined, 'GET');
    assert.equal(stateResponse.status, 200);
    const state = await readJson(stateResponse);
    const initialData = {
      ...state.data,
      expenses: [{ id: 'E-1', vendor: 'Acme Upholstery', amount: 100, date: '2026-01-01' }],
      invoices: [{ id: 'I-1', customer: 'Acme Upholstery', paid: 0 }],
    };
    const saveResponse = await server.request('/api/state', { revision: state.revision, data: initialData }, 'PUT');
    assert.equal(saveResponse.status, 200, await saveResponse.text());

    const searchResponse = await server.request('/api/ai/source-search', { query: 'INV-1' });
    assert.equal(searchResponse.status, 200);
    const search = await readJson(searchResponse);
    assert.equal(search.matches.length, 1);
    assert.equal(search.matches[0].name, 'invoice.txt');
    assert(!JSON.stringify(search).includes('UNSELECTED_SOURCE_CONTENT'));

    const reconcileResponse = await server.request('/api/ai/source-reconcile', {
      searchId: search.searchId,
      sourceIds: [search.matches[0].sourceId],
      query: 'Check the current expense amount against this invoice.',
    });
    assert.equal(reconcileResponse.status, 200);
    const review = await readJson(reconcileResponse);
    assert.equal(review.proposals.length, 1, 'The server must reject payment-field, unsupported-evidence and unknown-record suggestions.');
    assert.equal(review.filteredProposalCount, 3);
    assert.equal(review.proposals[0].value, 125);
    assert.equal(review.proposals[0].currentValue, 100);

    const requestBody = JSON.parse(fs.readFileSync(server.requestLogPath, 'utf8'));
    const promptText = requestBody.system_instruction.parts.map(part => part.text || '').join(' ');
    assert(promptText.includes('Acme Upholstery reference INV-1 Amount 125.00'));
    assert(!promptText.includes('UNSELECTED_SOURCE_CONTENT'), 'Only selected documents may be forwarded to Gemini.');
    assert.equal(requestBody.contents[0].parts.some(part => part.inline_data), false, 'Text documents are sent as extracted selected-source evidence only.');

    const unchanged = await readJson(await server.request('/api/state', undefined, 'GET'));
    assert.equal(unchanged.data.expenses[0].amount, 100, 'Generating a proposal must not write accounting state.');
    const verifiedSource = await readJson(await server.request('/api/ai/source-verify', {
      searchId: search.searchId,
      sourceId: search.matches[0].sourceId,
      collection: 'expenses',
      recordId: 'E-1',
      field: 'amount',
      currentValuePresent: true,
      currentValue: 100,
    }));
    assert.equal(verifiedSource.valid, true);
    assert.equal(verifiedSource.revision, unchanged.revision);

    const imageSearch = await readJson(await server.request('/api/ai/source-search', { query: 'INV-2' }));
    assert.equal(imageSearch.matches.length, 1);
    assert.equal(imageSearch.matches[0].name, 'Receipt-INV-2.jpg');
    const imagePreview = await server.request(`/api/ai/source-preview?searchId=${encodeURIComponent(imageSearch.searchId)}&sourceId=${encodeURIComponent(imageSearch.matches[0].sourceId)}`, undefined, 'GET');
    assert.equal(imagePreview.status, 200);
    assert.equal(imagePreview.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await imagePreview.arrayBuffer()), server.imageBytes);
    const imageReview = await readJson(await server.request('/api/ai/source-reconcile', {
      searchId: imageSearch.searchId,
      sourceIds: [imageSearch.matches[0].sourceId],
      query: 'Read the receipt and check the expense amount.',
    }));
    assert.equal(imageReview.proposals.length, 1, 'User-reviewed visual OCR should support evidence-backed proposals.');
    assert.equal(imageReview.proposals[0].evidence, 'Amount 125.00');
    const imageRequestBody = JSON.parse(fs.readFileSync(server.requestLogPath, 'utf8'));
    const inlineDocument = imageRequestBody.contents[0].parts.find(part => part.inline_data);
    assert.equal(inlineDocument.inline_data.mime_type, 'image/jpeg');
    assert.equal(inlineDocument.inline_data.data, server.imageBytes.toString('base64'));

    const changedData = {
      ...unchanged.data,
      expenses: unchanged.data.expenses.map(record => record.id === 'E-1' ? { ...record, amount: 101 } : record),
    };
    const changeResponse = await server.request('/api/state', { revision: unchanged.revision, data: changedData }, 'PUT');
    assert.equal(changeResponse.status, 200);
    const staleRecordResponse = await server.request('/api/ai/source-verify', {
      searchId: search.searchId,
      sourceId: search.matches[0].sourceId,
      collection: 'expenses',
      recordId: 'E-1',
      field: 'amount',
      currentValuePresent: true,
      currentValue: 100,
    });
    assert.equal(staleRecordResponse.status, 409, 'Verification must reject records changed on the server after comparison.');

    const originalStat = fs.statSync(server.sourcePath);
    fs.writeFileSync(server.sourcePath, 'Acme Upholstery reference INV-1 Amount 225.00');
    fs.utimesSync(server.sourcePath, originalStat.atime, originalStat.mtime);
    const staleResponse = await server.request('/api/ai/source-verify', {
      searchId: search.searchId,
      sourceId: search.matches[0].sourceId,
      collection: 'expenses',
      recordId: 'E-1',
      field: 'amount',
      currentValuePresent: true,
      currentValue: 101,
    });
    assert.equal(staleResponse.status, 409, 'Hash verification must catch same-size edits even when the timestamp is restored.');
    const stillUnchanged = await readJson(await server.request('/api/state', undefined, 'GET'));
    assert.equal(stillUnchanged.data.expenses[0].amount, 101);
  } finally {
    await stopServer(server);
  }
}

async function runHostedGuard() {
  const server = await startServer(false);
  try {
    const response = await server.request('/api/ai/source-search', { query: 'INV-1' });
    assert.equal(response.status, 503, 'Hosted mode must not access a developer workstation source library.');
  } finally {
    await stopServer(server);
  }
}

(async () => {
  await runLocalReviewFlow();
  await runHostedGuard();
  console.log('Assistant source review forwards selected evidence only, validates suggestions, and rejects stale sources without writing state.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
