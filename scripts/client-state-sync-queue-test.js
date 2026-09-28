const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const start = html.indexOf('function queueServerStateSave(){');
const end = html.indexOf('function resolveStateConflict(choice){', start);
assert.notEqual(start, -1, 'Client state-save queue was not found.');
assert.notEqual(end, -1, 'Client state-save queue end was not found.');

let releaseFirstRequest;
let requestCount = 0;
const requestBodies = [];
const context = {
  DB: { scannedDocuments: [{ id: 'scan-1', reviewStatus: 'AI reviewed' }] },
  serverSyncTimer: null,
  serverSyncPending: false,
  serverSyncAvailable: true,
  serverSyncInFlight: false,
  serverSyncPromise: null,
  serverSyncError: null,
  serverConflict: null,
  serverRevision: 0,
  serverRetryTimer: null,
  serverRetryAttempt: 0,
  fetch: async (_, options) => {
    requestCount += 1;
    requestBodies.push(JSON.parse(options.body).data);
    if (requestCount === 1) await new Promise(resolve => { releaseFirstRequest = resolve; });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        revision: requestCount,
        supabaseSync: { configured: true, status: 'synced' },
      }),
    };
  },
  refreshAuthSession: async () => false,
  stateRequestError: async (_, fallback) => new Error(fallback),
  toast: () => {},
  console,
  setTimeout,
  clearTimeout,
  Promise,
  JSON,
  Math,
  Error,
};
vm.createContext(context);
vm.runInContext(`
  ${html.slice(start, end)}
  globalThis.runSync = syncServerState;
  globalThis.queueSave = queueServerStateSave;
`, context, { timeout: 1000 });

const run = async () => {
  try {
    const firstSave = context.runSync(true, true);
    while (!releaseFirstRequest) await new Promise(resolve => setTimeout(resolve, 1));

    context.DB.scannedDocuments[0].amount = 123.45;
    context.queueSave();
    const forcedSave = context.runSync(true, true);
    assert.equal(context.serverSyncPending, true, 'A save during an active request must remain pending.');

    releaseFirstRequest();
    await Promise.all([firstSave, forcedSave]);
    const deadline = Date.now() + 3000;
    while (requestCount < 2 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    assert.equal(requestCount, 2, 'A follow-up request should flush changes made during the first sync.');
    assert.equal(requestBodies[0].scannedDocuments[0].amount, undefined);
    assert.equal(requestBodies[1].scannedDocuments[0].reviewStatus, 'AI reviewed');
    assert.equal(requestBodies[1].scannedDocuments[0].amount, 123.45);
    console.log('Client state changes made during an in-flight upload are queued and persisted afterward.');
  } finally {
    clearTimeout(context.serverSyncTimer);
    clearTimeout(context.serverRetryTimer);
  }
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
