const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

let stateUpserts = 0;
let syncedRow = null;
const supabaseMock = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/rest/v1/uw_accounting_data') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(syncedRow ? [syncedRow] : []));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/rest/v1/uw_accounting_data') {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      stateUpserts += 1;
      if (stateUpserts === 1) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: 'temporary test outage' }));
        return;
      }
      syncedRow = JSON.parse(body);
      response.writeHead(201);
      response.end();
    });
    return;
  }
  response.writeHead(404);
  response.end();
});

const run = async () => {
  const supabasePort = await listen(supabaseMock);
  const port = 50000 + Math.floor(Math.random() * 1000);
  const dataRoot = path.join(os.tmpdir(), `uw-supabase-sync-${process.pid}`);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      UW_DATA_DIR: dataRoot,
      UW_DOCUMENTS_DIR: path.join(dataRoot, 'documents'),
      UW_API_KEY: '',
      UW_AUTH_USERS_JSON: '{}',
      SUPABASE_URL: `http://127.0.0.1:${supabasePort}`,
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      SUPABASE_WORKSPACE: 'default',
      SUPABASE_STATE_TABLE: 'uw_accounting_data',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  try {
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/state`);
        if (response.ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, `State endpoint did not become ready.${stderr ? `\n${stderr}` : ''}`);

    const saveResponse = await fetch(`http://127.0.0.1:${port}/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision: 0, data: { invoices: [{ id: 'sync-test' }], quotes: [] } }),
    });
    assert.equal(saveResponse.status, 200);
    const saved = await saveResponse.json();
    assert.equal(saved.revision, 1);
    assert.equal(saved.supabaseSync.configured, true);
    assert.ok(['pending', 'synced'].includes(saved.supabaseSync.status));

    const retryDeadline = Date.now() + 10000;
    let syncStatus;
    while (Date.now() < retryDeadline) {
      const statusResponse = await fetch(`http://127.0.0.1:${port}/api/supabase/status`);
      syncStatus = await statusResponse.json();
      if (syncStatus.stateSync?.status === 'synced' && syncStatus.stateSync.lastSyncedRevision === 1) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(stateUpserts, 2, 'A failed Supabase write should be retried exactly once after recovery.');
    assert.equal(syncStatus.stateSync.status, 'synced');
    assert.equal(syncStatus.stateSync.lastSyncedRevision, 1);
    assert.equal(syncedRow.revision, 1);
    assert.equal(syncedRow.data.invoices.length, 1);
    assert.equal(syncedRow.data.quotes.length, 0);

    const localResponse = await fetch(`http://127.0.0.1:${port}/api/state`);
    const local = await localResponse.json();
    assert.equal(local.revision, 1);
    assert.equal(local.data.invoices.length, 1);
    console.log('Local state saves immediately and automatically retries a failed Supabase sync until confirmed.');
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    await new Promise(resolve => supabaseMock.close(resolve));
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
