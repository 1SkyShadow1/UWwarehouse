const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const port = 48000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const dataRoot = path.join(require('os').tmpdir(), `uw-smoke-${process.pid}`);
const documentsRoot = path.join(dataRoot, 'documents');
const smokePassword = 'SmokePass-123!';
const smokeSalt = crypto.randomBytes(16).toString('hex');
const smokeHash = crypto.scryptSync(smokePassword, smokeSalt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
const smokeUsers = JSON.stringify({ smoke: { name: 'Smoke User', role: 'Owner', passwordHash: `scrypt$16384$8$1$${smokeSalt}$${smokeHash}` } });
const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    UW_DATA_DIR: dataRoot,
    UW_DOCUMENTS_DIR: documentsRoot,
    UW_API_KEY: '',
    UW_AUTH_USERS_JSON: smokeUsers,
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverError = '';
let serverOutput = '';
child.stderr.on('data', chunk => { serverError += chunk.toString(); });
child.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
let sessionCookie = '';
let csrfToken = '';

const apiFetch = (route, options = {}) => {
  const headers = new Headers(options.headers || {});
  if (sessionCookie) headers.set('Cookie', sessionCookie);
  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(String(options.method || 'GET').toUpperCase())) headers.set('x-csrf-token', csrfToken);
  return fetch(`${base}${route}`, { ...options, headers });
};

const waitForServer = async () => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready within 30 seconds (exit code ${child.exitCode ?? 'still running'}).${serverError.trim() ? `\n${serverError.trim()}` : ''}${serverOutput.trim() ? `\n${serverOutput.trim()}` : ''}`);
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
  expect(typeof readyJson.checks.durableAuth === 'boolean', 'Readiness does not report durable authentication.');

  const aiConfig = await fetch(`${base}/api/ai/config`);
  const aiConfigJson = await aiConfig.json();
  expect(typeof aiConfigJson.configured === 'boolean', 'AI config response is malformed.');
  expect(aiConfigJson.provider === 'gemini' && JSON.stringify(Object.keys(aiConfigJson.providers || {}).sort()) === JSON.stringify(['gemini']), 'AI config must be Gemini-only.');
  const authConfig = await fetch(`${base}/api/auth/config`);
  const authConfigJson = await authConfig.json();
  expect(authConfig.status === 200 && typeof authConfigJson.configured === 'boolean' && Array.isArray(authConfigJson.users), 'Auth config response is malformed.');
  expect(authConfigJson.configured && authConfigJson.users.some(user => user.email === 'smoke'), 'Smoke authentication user was not configured.');
  const unauthenticatedState = await fetch(`${base}/api/state`);
  expect(unauthenticatedState.status === 401, 'Protected state endpoint did not reject an unauthenticated request.');
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'smoke', password: smokePassword }),
  });
  const loginJson = await login.json();
  const setCookie = login.headers.get('set-cookie') || '';
  sessionCookie = setCookie.split(';', 1)[0];
  csrfToken = loginJson.csrfToken || '';
  expect(login.status === 200 && sessionCookie.startsWith('uw_session=') && csrfToken, 'Login did not issue a session cookie and CSRF token.');
  const session = await apiFetch('/api/auth/session');
  const sessionJson = await session.json();
  expect(session.status === 200 && sessionJson.authenticated === true, 'Issued session cookie was not accepted by the session endpoint.');
  const missingCsrf = await fetch(`${base}/api/state`, {
    method: 'PUT',
    headers: { Cookie: sessionCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ revision: 0, data: { smoke: 'csrf-must-be-required' } }),
  });
  expect(missingCsrf.status === 403, 'State mutation did not reject a session request without a CSRF token.');
  const unknownApi = await apiFetch('/api/does-not-exist');
  const unknownApiJson = await unknownApi.json();
  expect(unknownApi.status === 404 && unknownApiJson.error === 'API route not found.', 'Unknown API errors are not explicit.');

  const invalidAi = await apiFetch('/api/ai/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: '' }),
  });
  expect(invalidAi.status === 400, 'AI endpoint did not reject an empty prompt.');

  const driveStatus = await apiFetch('/api/google-drive/status');
  const driveStatusJson = await driveStatus.json();
  expect(driveStatus.status === 200 && typeof driveStatusJson.connected === 'boolean', 'Drive status response is malformed.');

  const supabaseStatus = await apiFetch('/api/supabase/status');
  expect([200, 502, 503].includes(supabaseStatus.status), 'Supabase status endpoint returned an unexpected status.');
  const supabaseStatusJson = await supabaseStatus.json();
  expect(typeof supabaseStatusJson.configured === 'boolean', 'Supabase status response is malformed.');

  const state = await apiFetch('/api/state');
  const stateJson = await state.json();
  expect(state.status === 200 && Number.isInteger(stateJson.revision), 'State endpoint is malformed.');
  const pdfExport = await apiFetch('/api/documents/export-pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'invoice',
      record: { id: 'BB2026/09/2101', date: '2026-09-21', customer: 'Smoke Test', items: [{ desc: 'Test work', qty: 1, price: 100 }] },
    }),
  });
  const pdfBytes = Buffer.from(await pdfExport.arrayBuffer());
  expect(pdfExport.status === 200 && pdfExport.headers.get('content-type')?.startsWith('application/pdf') && pdfBytes.subarray(0, 5).toString() === '%PDF-', 'PDF document export failed.');
  const savedState = await apiFetch('/api/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: stateJson.revision, data: { smoke: true } }),
  });
  const savedStateJson = await savedState.json();
  expect(savedState.status === 200 && savedStateJson.data.smoke === true, 'State persistence failed.');
  const conflict = await apiFetch('/api/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: stateJson.revision, data: { smoke: false } }),
  });
  expect(conflict.status === 409, 'State revision conflict was not enforced.');
  const invalidState = await apiFetch('/api/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: savedStateJson.revision, data: { invoices: {} } }),
  });
  expect(invalidState.status === 400, 'Malformed state was accepted.');

  const form = new FormData();
  const invalidForm = new FormData();
  invalidForm.append('file', new Blob(['not a pdf'], { type: 'application/pdf' }), 'fake.pdf');
  const invalidUpload = await apiFetch('/api/documents', { method: 'POST', body: invalidForm });
  expect(invalidUpload.status === 415, 'Upload signature validation did not reject a mismatched file.');
  form.append('file', new Blob(['UW smoke document'], { type: 'text/plain' }), 'smoke.txt');
  const upload = await apiFetch('/api/documents', { method: 'POST', body: form });
  const uploadJson = await upload.json();
  expect(upload.status === 201 && uploadJson.id && uploadJson.url, `Managed document upload failed (${upload.status}): ${uploadJson.error || 'unknown error'}.`);
  const document = await apiFetch(uploadJson.url);
  expect(document.status === 200 && (await document.text()) === 'UW smoke document', 'Managed document serving failed.');
  const catalog = await apiFetch('/api/documents/catalog');
  const catalogJson = await catalog.json();
  expect(catalog.status === 200 && typeof catalogJson.configured === 'boolean' && Array.isArray(catalogJson.files), 'Document catalog response is malformed.');

  console.log(JSON.stringify({
    ok: true,
    port,
    checks: ['health', 'security headers', 'readiness', 'AI config', 'auth config', 'session cookie and CSRF', 'unauthenticated state rejection', 'CSRF rejection', 'authenticated state persistence', 'revision conflicts', 'state schema validation', 'AI validation', 'Drive status', 'Supabase status', 'upload signature validation', 'document upload/serve', 'document catalog'],
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
