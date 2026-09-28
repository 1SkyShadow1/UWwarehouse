const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const remoteSnapshot = {
  workspace_id: 'default',
  version: 1,
  revision: 42,
  updated_at: '2020-01-01T00:00:00.000Z',
  data: { preservedRemoteValue: 'authoritative Supabase data', invoices: [] },
};
let stateUpserts = 0;
const supabaseMock = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/rest/v1/uw_accounting_data') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify([remoteSnapshot]));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/rest/v1/uw_accounting_data') {
    stateUpserts += 1;
    response.writeHead(201);
    response.end();
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end('[]');
});

const run = async () => {
  const supabasePort = await listen(supabaseMock);
  const port = 49000 + Math.floor(Math.random() * 1000);
  const dataRoot = path.join(os.tmpdir(), `uw-supabase-bootstrap-${process.pid}`);
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
    let snapshotResponse;
    while (Date.now() < deadline) {
      try {
        snapshotResponse = await fetch(`http://127.0.0.1:${port}/api/state`);
        if (snapshotResponse.ok) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(snapshotResponse?.ok, `State endpoint did not become ready.${stderr ? `\n${stderr}` : ''}`);
    const localSnapshot = await snapshotResponse.json();
    assert.equal(localSnapshot.revision, remoteSnapshot.revision);
    assert.deepEqual(localSnapshot.data, remoteSnapshot.data);
    assert.equal(stateUpserts, 0, 'A pristine local install must not upsert its empty state over existing Supabase data.');
    console.log('Pristine local startup restores existing Supabase data without overwriting it.');
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    await new Promise(resolve => supabaseMock.close(resolve));
    require('node:fs').rmSync(dataRoot, { recursive: true, force: true });
  }
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
