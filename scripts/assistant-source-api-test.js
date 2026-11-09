const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');

const startServer = async localOnly => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uw-assistant-api-'));
  const sourceRoot = path.join(tempRoot, 'UW');
  fs.mkdirSync(sourceRoot, { recursive: true });
  const additionalSourceRoot = path.join(tempRoot, 'UW-archive');
  fs.mkdirSync(additionalSourceRoot, { recursive: true });
  fs.writeFileSync(path.join(additionalSourceRoot, 'archived-ledger.txt'), 'Archived source UW-ARCHIVE-77 for Acme Upholstery.');
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
      UW_SOURCE_DIRS: additionalSourceRoot,
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
      meta: { ...(state.data.meta || {}), privateApiKey: 'fixture-ledger-secret' },
      expenses: [{ id: 'E-1', vendor: 'Acme Upholstery', amount: 100, date: '2026-01-01', apiKey: 'fixture-record-secret' }],
      invoices: [{ id: 'I-1', customer: 'Acme Upholstery', paid: 0 }],
      scannedDocuments: [{ id: 'SCAN-1', merchant: 'Acme Upholstery', data: 'fixture-base64-document' }],
    };
    const saveResponse = await server.request('/api/state', { revision: state.revision, data: initialData }, 'PUT');
    assert.equal(saveResponse.status, 200, await saveResponse.text());
    const savedSnapshot = await readJson(await server.request('/api/state', undefined, 'GET'));
    assert.equal(savedSnapshot.data.ledgerActivity.length, 1, 'State writes must persist a server-generated ledger activity entry.');
    assert.equal(savedSnapshot.data.ledgerActivity[0].actor, 'API key');
    assert(savedSnapshot.data.ledgerActivity[0].changes.some(change => change.collection === 'expenses' && change.id === 'E-1'));
    assert.equal(savedSnapshot.data.ledgerActivityCoverage.retainedEvents, 1, 'State writes expose server-generated retained-history coverage.');

    const geminiChatResponse = await server.request('/api/ai/generate', {
      provider: 'gemini',
      prompt: 'What is the current state of expense E-1?',
      sourceQuery: 'INV-1',
      context: { relevantRecords: [], source: 'client context intentionally omits ledger rows' },
    });
    assert.equal(geminiChatResponse.status, 200);
    const geminiChat = await readJson(geminiChatResponse);
    assert.equal(geminiChat.ledgerRevision, savedSnapshot.revision);
    const geminiBody = JSON.parse(fs.readFileSync(server.requestLogPath, 'utf8'));
    const geminiSystemText = geminiBody.system_instruction.parts.map(part => part.text || '').join(' ');
    assert(geminiSystemText.includes('"id":"E-1"') && geminiSystemText.includes('"amount":100'), 'Gemini must receive current server ledger rows even when the client sends only a summary.');
    assert(geminiSystemText.includes('"actor":"API key"'), 'Gemini should receive the saved change history with its operator.');
    assert(geminiSystemText.includes('client context intentionally omits ledger rows'), 'Question-specific app evidence remains supplemental context.');
    assert(!geminiSystemText.includes('fixture-ledger-secret') && !geminiSystemText.includes('fixture-record-secret') && !geminiSystemText.includes('fixture-base64-document'), 'Gemini context must omit credentials and document binaries.');
    assert(geminiSystemText.includes('Acme Upholstery reference INV-1 Amount 125.00'), 'Gemini chat should retrieve matching text from the configured source library without a separate compare flow.');
    assert.equal(geminiChat.sourceCoverage.status, 'partial', 'Image-only sources that cannot be text-indexed must be disclosed as incomplete coverage.');
    assert.equal(geminiChat.sourceCoverage.rootsSearched, 2, 'Chat search must cover every configured source root.');

    const archivedSource = await server.request('/api/ai/generate', {
      provider: 'gemini',
      prompt: 'Find archived source UW-ARCHIVE-77.',
      sourceQuery: 'UW-ARCHIVE-77',
    });
    assert.equal(archivedSource.status, 200);
    const archivedSourceText = JSON.parse(fs.readFileSync(server.requestLogPath, 'utf8')).system_instruction.parts.map(part => part.text || '').join(' ');
    assert(archivedSourceText.includes('Archived source UW-ARCHIVE-77 for Acme Upholstery.'), 'The assistant must search additional configured source roots, not only the primary folder.');

    const imageChat = await server.request('/api/ai/generate', {
      provider: 'gemini',
      prompt: 'Read the matching receipt image INV-2.',
      sourceQuery: 'INV-2',
    });
    assert.equal(imageChat.status, 200);
    const imageChatPayload = await readJson(imageChat);
    const imageChatBody = JSON.parse(fs.readFileSync(server.requestLogPath, 'utf8'));
    const imagePart = imageChatBody.contents[0].parts.find(part => part.inline_data);
    assert.equal(imagePart.inline_data.mime_type, 'image/jpeg');
    assert.equal(imagePart.inline_data.data, server.imageBytes.toString('base64'));
    assert.equal(imageChatPayload.sourceCoverage.inlineDocumentsIncluded[0], 'Receipt-INV-2.jpg');

    const managedPdf = await PDFDocument.create();
    managedPdf.addPage().drawText('Managed source INV-3 Acme Upholstery amount 245.00');
    const managedPdfBytes = await managedPdf.save();
    const uploadForm = new FormData();
    uploadForm.append('file', new Blob([managedPdfBytes], { type: 'application/pdf' }), 'Managed-INV-3.pdf');
    const uploadResponse = await fetch(`${server.base}/api/documents`, {
      method: 'POST',
      headers: { 'x-api-key': 'assistant-source-test-key' },
      body: uploadForm,
    });
    assert.equal(uploadResponse.status, 201, await uploadResponse.text());
    const managedChatResponse = await server.request('/api/ai/generate', {
      provider: 'gemini',
      prompt: 'Find the managed upload INV-3.',
      sourceQuery: 'INV-3',
    });
    assert.equal(managedChatResponse.status, 200);
    const managedChat = await readJson(managedChatResponse);
    const managedPrompt = JSON.parse(fs.readFileSync(server.requestLogPath, 'utf8')).system_instruction.parts.map(part => part.text || '').join(' ');
    assert(managedPrompt.includes('Managed source INV-3 Acme Upholstery amount 245.00'), 'Gemini chat should search text in uploaded managed documents.');
    assert.equal(managedChat.sourceCoverage.managedFilesFound, 1);
    assert.equal(managedChat.sourceCoverage.managedFilesSearched, 1);

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

    const secondUpdateData = {
      ...stillUnchanged.data,
      ledgerActivity: [{ id: 'client-forged-activity' }],
      expenses: stillUnchanged.data.expenses.map(record => record.id === 'E-1' ? { ...record, amount: 102 } : record),
    };
    const secondUpdate = await server.request('/api/state', { revision: stillUnchanged.revision, data: secondUpdateData }, 'PUT');
    assert.equal(secondUpdate.status, 200);
    const secondSnapshot = await readJson(secondUpdate);
    assert.equal(secondSnapshot.data.ledgerActivity.length, stillUnchanged.data.ledgerActivity.length + 1, 'Client snapshots cannot replace or clear server-owned activity history.');
    assert.deepEqual(secondSnapshot.data.ledgerActivity.slice(0, -1), stillUnchanged.data.ledgerActivity, 'All prior server-owned activity must be preserved.');
    assert.equal(secondSnapshot.data.ledgerActivity.at(-1).revision, secondSnapshot.revision);
    assert.equal(secondSnapshot.data.ledgerActivityCoverage.retainedEvents, secondSnapshot.data.ledgerActivity.length);
    const expenseChange = secondSnapshot.data.ledgerActivity.at(-1).changes.find(change => change.collection === 'expenses' && change.id === 'E-1');
    assert(expenseChange.fields.some(field => field.field === 'amount' && field.before === 101 && field.after === 102));
    const updatedGemini = await server.request('/api/ai/generate', {
      provider: 'gemini',
      prompt: 'What changed since the prior save?',
      context: { relevantRecords: [] },
    });
    assert.equal(updatedGemini.status, 200);
    const updatedGeminiBody = JSON.parse(fs.readFileSync(server.requestLogPath, 'utf8'));
    const updatedGeminiSystem = updatedGeminiBody.system_instruction.parts.map(part => part.text || '').join(' ');
    assert(updatedGeminiSystem.includes('"amount":102') && updatedGeminiSystem.includes('"before":101') && updatedGeminiSystem.includes('"after":102'));

    const beforeLargeSave = await readJson(await server.request('/api/state', undefined, 'GET'));
    const largeData = {
      ...beforeLargeSave.data,
      archiveRecords: Array.from({ length: 4 }, (_, index) => ({
        id: `ARCHIVE-${index + 1}`,
        description: 'large archival record '.repeat(23000),
      })),
    };
    const largeSave = await server.request('/api/state', { revision: beforeLargeSave.revision, data: largeData }, 'PUT');
    assert.equal(largeSave.status, 200, await largeSave.text());
    const oversizedLedgerChat = await readJson(await server.request('/api/ai/generate', {
      provider: 'gemini',
      prompt: 'Find the exact archival record ARCHIVE-3.',
      sourceQuery: 'ARCHIVE-3',
    }));
    assert.equal(oversizedLedgerChat.ledgerCoverage.mode, 'query-scoped');
    assert.equal(oversizedLedgerChat.ledgerCoverage.recordsReturned, 1);
    assert(oversizedLedgerChat.ledgerCoverage.totalRecords >= 4);
    const oversizedSystem = JSON.parse(fs.readFileSync(server.requestLogPath, 'utf8')).system_instruction.parts.map(part => part.text || '').join(' ');
    assert(oversizedSystem.includes('"mode":"query-scoped"') && oversizedSystem.includes('"id":"ARCHIVE-3"'));
    assert(!oversizedSystem.includes('"id":"ARCHIVE-1"'), 'Large ledgers should send matching rows rather than unrelated full records.');
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
  console.log('Assistant chat searches all configured local source roots, retrieves matching scans and ledger records, and retains review-first source updates.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
