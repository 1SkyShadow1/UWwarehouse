const { spawn } = require('child_process');
const path = require('path');

const port = 48000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const dataRoot = path.join(require('os').tmpdir(), `uw-smoke-${process.pid}`);
const documentsRoot = path.join(dataRoot, 'documents');
const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    UW_DATA_DIR: dataRoot,
    UW_DOCUMENTS_DIR: documentsRoot,
    UW_API_KEY: '',
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverError = '';
child.stderr.on('data', chunk => { serverError += chunk.toString(); });

const waitForServer = async () => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server did not become ready within 30 seconds.');
};

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

const run = async () => {
  await waitForServer();

  const health = await fetch(`${base}/api/health`);
  const healthJson = await health.json();
  expect(health.status === 200 && healthJson.ok === true, 'Health endpoint failed.');
  expect(health.headers.get('x-content-type-options') === 'nosniff', 'Missing X-Content-Type-Options header.');
  expect(health.headers.get('x-frame-options') === 'SAMEORIGIN', 'Missing X-Frame-Options header.');

  const ready = await fetch(`${base}/api/ready`);
  expect([200, 503].includes(ready.status), 'Readiness endpoint returned an unexpected status.');
  const readyJson = await ready.json();
  expect(typeof readyJson.ready === 'boolean' && readyJson.checks, 'Readiness response is malformed.');
  expect(typeof readyJson.checks.persistentStorage === 'boolean', 'Readiness does not report persistent storage.');

  const aiConfig = await fetch(`${base}/api/ai/config`);
  const aiConfigJson = await aiConfig.json();
  expect(typeof aiConfigJson.configured === 'boolean', 'AI config response is malformed.');

  const invalidAi = await fetch(`${base}/api/ai/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: '' }),
  });
  expect(invalidAi.status === 400, 'AI endpoint did not reject an empty prompt.');

  const driveStatus = await fetch(`${base}/api/google-drive/status`);
  const driveStatusJson = await driveStatus.json();
  expect(driveStatus.status === 200 && typeof driveStatusJson.connected === 'boolean', 'Drive status response is malformed.');

  const supabaseStatus = await fetch(`${base}/api/supabase/status`);
  expect([200, 502, 503].includes(supabaseStatus.status), 'Supabase status endpoint returned an unexpected status.');
  const supabaseStatusJson = await supabaseStatus.json();
  expect(typeof supabaseStatusJson.configured === 'boolean', 'Supabase status response is malformed.');

  const state = await fetch(`${base}/api/state`);
  const stateJson = await state.json();
  expect(state.status === 200 && Number.isInteger(stateJson.revision), 'State endpoint is malformed.');
  const savedState = await fetch(`${base}/api/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: stateJson.revision, data: { smoke: true } }),
  });
  const savedStateJson = await savedState.json();
  expect(savedState.status === 200 && savedStateJson.data.smoke === true, 'State persistence failed.');
  const conflict = await fetch(`${base}/api/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: stateJson.revision, data: { smoke: false } }),
  });
  expect(conflict.status === 409, 'State revision conflict was not enforced.');

  const form = new FormData();
  form.append('file', new Blob(['UW smoke document'], { type: 'text/plain' }), 'smoke.txt');
  const upload = await fetch(`${base}/api/documents`, { method: 'POST', body: form });
  const uploadJson = await upload.json();
  expect(upload.status === 201 && uploadJson.id && uploadJson.url, `Managed document upload failed (${upload.status}): ${uploadJson.error || 'unknown error'}.`);
  const document = await fetch(`${base}${uploadJson.url}`);
  expect(document.status === 200 && (await document.text()) === 'UW smoke document', 'Managed document serving failed.');
  const catalog = await fetch(`${base}/api/documents/catalog`);
  const catalogJson = await catalog.json();
  expect(catalog.status === 200 && typeof catalogJson.configured === 'boolean' && Array.isArray(catalogJson.files), 'Document catalog response is malformed.');

  console.log(JSON.stringify({
    ok: true,
    port,
    checks: ['health', 'security headers', 'readiness', 'AI config', 'AI validation', 'Drive status', 'Supabase status', 'state persistence', 'revision conflicts', 'document upload/serve', 'document catalog'],
  }, null, 2));
};

run()
  .catch(error => {
    console.error(error.message);
    if (serverError.trim()) console.error(serverError.trim());
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill();
  });
