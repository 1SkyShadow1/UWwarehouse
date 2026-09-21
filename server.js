require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');
const multer = require('multer');

const app = express();
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const rootDir = __dirname;
const sourceRoot = process.env.UW_SOURCE_DIR || 'D:\\UW';
const adjacentSourceRoot = path.resolve(rootDir, '..', '..', '..', 'UWwarehouse');
const sourceRoots = [...new Set([
  sourceRoot,
  adjacentSourceRoot,
  path.join(adjacentSourceRoot, 'UW'),
  path.join(adjacentSourceRoot, 'UW INVOICES-RECEIPTS&EXPENSES'),
  path.join(adjacentSourceRoot, 'UW INVOICES-RECEIPTS& EXPENSES 2 B'),
  path.join(rootDir, '__source'),
  path.join(rootDir, 'documents'),
  path.join(rootDir, 'newstatements'),
])];
const defaultDataRoot = path.join(rootDir, 'data');
const configuredDataRoot = process.env.UW_DATA_DIR || defaultDataRoot;
const canUseDirectory = candidate => {
  try {
    fs.mkdirSync(candidate, { recursive: true });
    const probe = path.join(candidate, `.write-check-${process.pid}`);
    fs.writeFileSync(probe, 'ok', { flag: 'wx' });
    fs.rmSync(probe, { force: true });
    return true;
  } catch (_) {
    return false;
  }
};
const dataRoot = canUseDirectory(configuredDataRoot)
  ? configuredDataRoot
  : (console.warn(`UW_DATA_DIR is not writable: ${configuredDataRoot}. Falling back to ${defaultDataRoot}. Configure a writable Render disk path such as /var/data/uw-accounting.`), defaultDataRoot);
const dataRootFallback = path.resolve(dataRoot) !== path.resolve(configuredDataRoot);
const defaultStateFile = path.join(dataRoot, 'uw-state.json');
const configuredStateFile = process.env.UW_DB_FILE || defaultStateFile;
const stateFile = canUseDirectory(path.dirname(configuredStateFile))
  ? configuredStateFile
  : (console.warn(`UW_DB_FILE is not writable: ${configuredStateFile}. Falling back to ${defaultStateFile}.`), defaultStateFile);
const configuredDocumentsRoot = process.env.UW_DOCUMENTS_DIR || path.join(dataRoot, 'documents');
const documentsRoot = canUseDirectory(configuredDocumentsRoot)
  ? configuredDocumentsRoot
  : (console.warn(`UW_DOCUMENTS_DIR is not writable: ${configuredDocumentsRoot}. Falling back to ${path.join(dataRoot, 'documents')}.`), path.join(dataRoot, 'documents'));
const documentsRootFallback = path.resolve(documentsRoot) !== path.resolve(configuredDocumentsRoot);
const sourceSearchCache = new Map();
let sourceFileIndex;
let sourceStemIndex;
const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const supabaseServiceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabaseWorkspace = String(process.env.SUPABASE_WORKSPACE || 'default').trim() || 'default';
const supabaseStateTable = String(process.env.SUPABASE_STATE_TABLE || 'uw_accounting_data').trim() || 'uw_accounting_data';
const supabaseDocumentBucket = String(process.env.SUPABASE_DOCUMENT_BUCKET || 'uw-documents').trim() || 'uw-documents';
const supabaseSessionTable = String(process.env.SUPABASE_SESSION_TABLE || 'uw_auth_sessions').trim() || 'uw_auth_sessions';
const supabaseSecretTable = String(process.env.SUPABASE_SECRET_TABLE || 'uw_secure_secrets').trim() || 'uw_secure_secrets';
const tokenEncryptionKey = (() => {
  const raw = String(process.env.UW_TOKEN_ENCRYPTION_KEY || '').trim();
  try {
    const key = Buffer.from(raw, 'base64');
    return key.length === 32 ? key : null;
  } catch (_) {
    return null;
  }
})();
const remoteStorageCache = { expiresAt: 0, files: [], error: '' };
const remoteDocumentCache = new Map();
const remoteDocumentCacheTtlMs = 10 * 60 * 1000;
const remoteDocumentCacheMaxEntries = 24;
const stateVersion = 1;
const maxDocumentBytes = Number(process.env.UW_MAX_DOCUMENT_BYTES || 25 * 1024 * 1024);
const allowedDocumentTypes = new Set((process.env.UW_DOCUMENT_MIME_TYPES || [
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
].join(',')).split(',').map(x => x.trim()).filter(Boolean));
const hasDocumentSignature = (buffer, mimeType) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mimeType === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mimeType.startsWith('application/vnd.openxmlformats-officedocument.')) return buffer.subarray(0, 2).toString('ascii') === 'PK';
  return mimeType === 'text/plain';
};
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) app.set('trust proxy', 1);
const stateStore = new Map();
const aiRateStore = new Map();
const authSessions = new Map();
const authAttempts = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;
const AI_RATE_WINDOW_MS = 15 * 60 * 1000;
const AI_RATE_LIMIT = 20;
const AUTH_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const uploadTempRoot = path.join(dataRoot, 'upload-tmp');
fs.mkdirSync(uploadTempRoot, { recursive: true });
const durableAuthConfigured = () => supabaseConfigured() && Boolean(tokenEncryptionKey);
const driveState = {
  tokens: null,
  connected: false,
  accountEmail: '',
  fileId: '',
  fileName: 'UW_ACCOUNTING_BACKUP.json',
  folderId: '',
  backupFolderName: 'UW Accounting Backups',
  lastSync: null,
};
const parseAuthUsers = () => {
  try {
    const parsed = JSON.parse(process.env.UW_AUTH_USERS_JSON || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error('UW_AUTH_USERS_JSON is invalid:', error.message);
    return {};
  }
};
const authUsers = parseAuthUsers();
const authConfigured = () => Object.values(authUsers).some(user => user && typeof user === 'object' && typeof user.passwordHash === 'string' && user.passwordHash.startsWith('scrypt$'));
const getAuthUser = identifier => {
  const normalized = String(identifier || '').trim().toLowerCase();
  const direct = authUsers[normalized];
  if (direct) return { key: normalized, user: direct };
  const match = Object.entries(authUsers).find(([key, user]) => {
    const name = String(user?.name || '').trim().toLowerCase();
    return key.toLowerCase() === normalized || name === normalized;
  });
  return match ? { key: match[0], user: match[1] } : null;
};
const timingSafeEqualText = (a, b) => {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const verifyPassword = async (password, encoded) => {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, salt, expected] = parts;
  const n = Number(nRaw), r = Number(rRaw), p = Number(pRaw);
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p) || !salt || !expected) return false;
  return new Promise(resolve => crypto.scrypt(String(password || ''), salt, 64, { N: n, r, p }, (error, derived) => {
    resolve(!error && timingSafeEqualText(derived.toString('hex'), expected));
  }));
};
const sessionTokenFromRequest = req => {
  const token = String(req.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith('uw_session='));
  return token ? decodeURIComponent(token.slice('uw_session='.length)) : '';
};
const sessionFromRequest = req => {
  const value = sessionTokenFromRequest(req);
  const session = value && authSessions.get(value);
  if (!session || session.expiresAt <= Date.now()) {
    if (value) authSessions.delete(value);
    return null;
  }
  session.expiresAt = Date.now() + AUTH_SESSION_TTL_MS;
  return session;
};
const requestHasValidApiKey = req => {
  const expected = String(process.env.UW_API_KEY || '').trim();
  if (!expected) return false;
  const supplied = String(req.get('x-api-key') || '').trim() || String(req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return timingSafeEqualText(supplied, expected);
};
const requireSessionOrApiKey = async (req, res, next) => {
  if (requestHasValidApiKey(req)) return next();
  const token = sessionTokenFromRequest(req);
  const session = sessionFromRequest(req) || await loadDurableSession(token).catch(error => {
    console.error('Durable session lookup failed:', error.message);
    return null;
  });
  if (session && token) authSessions.set(token, session);
  if (!session && (isProduction || authConfigured())) return res.status(401).json({ error: 'Authentication required.' });
  req.auth = session || { email: 'local', name: 'Local operator', role: 'Owner' };
  return next();
};
const requireCsrf = async (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || requestHasValidApiKey(req) || req.path.startsWith('/auth/')) return next();
  const token = sessionTokenFromRequest(req);
  const session = sessionFromRequest(req) || await loadDurableSession(token).catch(() => null);
  if (session && !timingSafeEqualText(req.get('x-csrf-token'), session.csrfToken)) return res.status(403).json({ error: 'CSRF validation failed.' });
  return next();
};

let stateSnapshot;
let stateWrite = Promise.resolve();
let bootstrapReady = Promise.resolve();
let bootstrapComplete = true;
const ensureStorage = () => {
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(documentsRoot, { recursive: true });
  if (!stateSnapshot) {
    if (fs.existsSync(stateFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        if (!parsed || parsed.version !== stateVersion || typeof parsed.revision !== 'number' || !parsed.data || typeof parsed.data !== 'object') throw new Error('Unsupported datastore format');
        stateSnapshot = parsed;
      } catch (error) {
        const corrupt = `${stateFile}.corrupt-${Date.now()}`;
        fs.renameSync(stateFile, corrupt);
        console.warn(`Datastore was invalid and was moved to ${corrupt}: ${error.message}`);
      }
    }
    stateSnapshot = stateSnapshot || { version: stateVersion, revision: 0, updatedAt: new Date().toISOString(), data: {} };
    atomicWrite(stateSnapshot);
  }
  return stateSnapshot;
};
const atomicWrite = (snapshot) => {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const temp = `${stateFile}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  if (fs.existsSync(stateFile)) fs.copyFileSync(stateFile, `${stateFile}.bak`);
  fs.writeFileSync(temp, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temp, stateFile);
};
const queueStateWrite = (next) => {
  stateWrite = stateWrite.then(() => {
    atomicWrite(next);
    stateSnapshot = next;
    return syncSnapshotToSupabase(next).catch(error => {
      console.error(error.message);
      return next;
    });
  });
  return stateWrite;
};
const supabaseConfigured = () => Boolean(supabaseUrl && supabaseServiceKey);
const supabaseHeaders = () => ({
  apikey: supabaseServiceKey,
  Authorization: `Bearer ${supabaseServiceKey}`,
  'Content-Type': 'application/json',
});
const encryptedSecret = value => {
  if (!tokenEncryptionKey) throw new Error('UW_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value || ''), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${ciphertext.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}`;
};
const decryptSecret = value => {
  if (!tokenEncryptionKey || !String(value || '').startsWith('v1:')) return '';
  try {
    const [, ivRaw, ciphertextRaw, tagRaw] = String(value).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', tokenEncryptionKey, Buffer.from(ivRaw, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextRaw, 'base64url')), decipher.final()]).toString('utf8');
  } catch (_) {
    return '';
  }
};
const supabaseRows = async (table, query) => {
  if (!supabaseConfigured()) return [];
  const response = await fetch(`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}?${query}`, {
    headers: supabaseHeaders(),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Supabase ${table} read failed (${response.status}).`);
  return response.json();
};
const upsertSupabaseRow = async (table, row, conflict) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}?on_conflict=${encodeURIComponent(conflict)}`, {
    method: 'POST',
    headers: { ...supabaseHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Supabase ${table} write failed (${response.status}).`);
};
const deleteSupabaseRows = async (table, query) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}?${query}`, {
    method: 'DELETE',
    headers: supabaseHeaders(),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Supabase ${table} delete failed (${response.status}).`);
};
const hashSessionToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');
const persistSession = async (token, session) => {
  if (!durableAuthConfigured()) return;
  await upsertSupabaseRow(supabaseSessionTable, {
    token_hash: hashSessionToken(token),
    workspace_id: supabaseWorkspace,
    email: session.email,
    name: session.name,
    role: session.role,
    csrf_token: encryptedSecret(session.csrfToken),
    expires_at: new Date(session.expiresAt).toISOString(),
  }, 'token_hash');
};
const loadDurableSession = async token => {
  if (!durableAuthConfigured() || !token) return null;
  const rows = await supabaseRows(supabaseSessionTable, `token_hash=eq.${encodeURIComponent(hashSessionToken(token))}&workspace_id=eq.${encodeURIComponent(supabaseWorkspace)}&select=email,name,role,csrf_token,expires_at&limit=1`);
  const row = rows[0];
  if (!row) return null;
  const expiresAt = Date.parse(row.expires_at || '');
  const csrfToken = decryptSecret(row.csrf_token);
  if (!csrfToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return { email: row.email, name: row.name, role: row.role, csrfToken, expiresAt };
};
const deleteDurableSession = async token => {
  if (!durableAuthConfigured() || !token) return;
  await deleteSupabaseRows(supabaseSessionTable, `token_hash=eq.${encodeURIComponent(hashSessionToken(token))}&workspace_id=eq.${encodeURIComponent(supabaseWorkspace)}`);
};
const persistDriveTokens = async () => {
  if (!durableAuthConfigured() || !driveState.tokens) return;
  await upsertSupabaseRow(supabaseSecretTable, {
    workspace_id: supabaseWorkspace,
    secret_name: 'google_drive_tokens',
    secret_value: encryptedSecret(JSON.stringify(driveState.tokens)),
    updated_at: new Date().toISOString(),
  }, 'workspace_id,secret_name');
};
const restoreDriveTokens = async () => {
  if (!durableAuthConfigured()) return;
  const rows = await supabaseRows(supabaseSecretTable, `workspace_id=eq.${encodeURIComponent(supabaseWorkspace)}&secret_name=eq.google_drive_tokens&select=secret_value&limit=1`);
  const raw = decryptSecret(rows[0]?.secret_value);
  if (!raw) return;
  try {
    driveState.tokens = JSON.parse(raw);
    driveState.connected = Boolean(driveState.tokens?.refresh_token || driveState.tokens?.access_token);
  } catch (error) {
    console.error('Stored Google Drive credentials are invalid:', error.message);
  }
};
const syncSnapshotToSupabase = async snapshot => {
  if (!supabaseConfigured()) return snapshot;
  const response = await fetch(`${supabaseUrl}/rest/v1/${encodeURIComponent(supabaseStateTable)}?on_conflict=workspace_id`, {
    method: 'POST',
    headers: { ...supabaseHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      workspace_id: supabaseWorkspace,
      version: snapshot.version,
      revision: snapshot.revision,
      data: snapshot.data,
      updated_at: snapshot.updatedAt,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Supabase state sync failed (${response.status}).`);
  return snapshot;
};
const restoreSnapshotFromSupabase = async () => {
  if (!supabaseConfigured()) return;
  const response = await fetch(
    `${supabaseUrl}/rest/v1/${encodeURIComponent(supabaseStateTable)}?workspace_id=eq.${encodeURIComponent(supabaseWorkspace)}&select=workspace_id,version,revision,data,updated_at&limit=1`,
    { headers: supabaseHeaders(), signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) throw new Error(`Supabase state load failed (${response.status}).`);
  const rows = await response.json();
  const remote = rows[0];
  if (!remote || !remote.data || remote.version !== stateVersion) {
    if (remote) console.warn('Supabase state row has an unsupported version; local state was preserved.');
    return;
  }
  const local = ensureStorage();
  const remoteUpdated = Date.parse(remote.updated_at || '');
  const localUpdated = Date.parse(local.updatedAt || '');
  if (remoteUpdated > localUpdated || (remoteUpdated === localUpdated && Number(remote.revision) > local.revision)) {
    stateSnapshot = {
      version: stateVersion,
      revision: Number(remote.revision) || 0,
      updatedAt: remote.updated_at || new Date().toISOString(),
      data: remote.data,
    };
    atomicWrite(stateSnapshot);
    return;
  }
  if (local.revision > Number(remote.revision || 0) || localUpdated > remoteUpdated) {
    await syncSnapshotToSupabase(local);
  }
};
const syncDocumentToSupabase = async (id, file) => {
  if (!supabaseConfigured()) return '';
  const safeName = path.basename(file.originalname || 'document').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 140) || 'document';
  const storagePath = `UW/${id}-${safeName}`;
  const response = await fetch(supabaseObjectUrl(storagePath), {
    method: 'POST',
    headers: { ...supabaseHeaders(), 'Content-Type': file.mimetype, 'x-upsert': 'true' },
    body: fs.createReadStream(file.path),
    duplex: 'half',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Supabase document upload failed (${response.status}).`);
  remoteStorageCache.expiresAt = 0;
  return storagePath;
};
const removeDocumentFromSupabase = async storagePath => {
  if (!storagePath || !supabaseConfigured()) return;
  try {
    await fetch(supabaseObjectUrl(storagePath), { method: 'DELETE', headers: supabaseHeaders(), signal: AbortSignal.timeout(15000) });
  } catch (error) {
    console.warn('Supabase orphan cleanup failed:', error.message);
  }
};
const documentBufferPrefix = async filePath => {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(64);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};
const supabaseObjectUrl = storagePath => {
  const encodedPath = String(storagePath || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return `${supabaseUrl}/storage/v1/object/${encodeURIComponent(supabaseDocumentBucket)}/${encodedPath}`;
};
const listSupabaseStorage = async () => {
  if (!supabaseConfigured()) return [];
  if (remoteStorageCache.expiresAt > Date.now()) return remoteStorageCache.files;
  const files = [];
  const folders = [''];
  const walk = async prefix => {
    let offset = 0;
    while (offset < 10000) {
      const response = await fetch(`${supabaseUrl}/storage/v1/object/list/${encodeURIComponent(supabaseDocumentBucket)}`, {
        method: 'POST',
        headers: { ...supabaseHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        remoteStorageCache.error = `Storage inventory failed (${response.status})`;
        console.warn(`Supabase Storage inventory failed for "${prefix}" (${response.status}).`);
        return;
      }
      const entries = await response.json();
      if (!Array.isArray(entries) || !entries.length) return;
      for (const entry of entries) {
        const entryPath = `${prefix ? `${prefix.replace(/\/+$/, '')}/` : ''}${entry.name}`.replace(/^\/+/, '');
        if (entry.id) {
          files.push({
            storagePath: entryPath,
            name: entry.name,
            mimeType: entry.metadata?.mimetype || entry.metadata?.mimeType || mimeForFile(entry.name),
          });
        } else {
          await walk(`${entryPath}/`);
        }
      }
      if (entries.length < 1000) return;
      offset += entries.length;
    }
  };
  for (const folder of folders) await walk(folder);
  remoteStorageCache.files = files;
  remoteStorageCache.error = '';
  remoteStorageCache.expiresAt = Date.now() + 60 * 1000;
  return files;
};
const loadDocumentFromSupabase = async storagePath => {
  if (!supabaseConfigured() || !storagePath) return null;
  const cacheKey = String(storagePath);
  const cached = remoteDocumentCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.buffer;
  if (cached) remoteDocumentCache.delete(cacheKey);
  const response = await fetch(supabaseObjectUrl(storagePath), {
    headers: supabaseHeaders(),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  remoteDocumentCache.set(cacheKey, { buffer, expiresAt: Date.now() + remoteDocumentCacheTtlMs });
  while (remoteDocumentCache.size > remoteDocumentCacheMaxEntries) {
    remoteDocumentCache.delete(remoteDocumentCache.keys().next().value);
  }
  return buffer;
};
const normalizeDocumentName = value => String(value || '')
  .toLowerCase()
  .replace(/reciepts/g, 'receipts')
  .replace(/[^a-z0-9]+/g, '');
const loadSourceObjectFromSupabase = async (requestedPath, requestedName) => {
  if (!supabaseConfigured()) return null;
  const name = path.basename(String(requestedName || requestedPath || '').replace(/\\/g, '/')).trim();
  if (!name) return null;
  const rawPath = String(requestedPath || '').trim().replace(/\\/g, '/');
  const relativePath = rawPath.replace(/^[A-Za-z]:\/+/i, '').replace(/^\/+/, '').replace(/^UW\//i, '');
  const pathCandidates = relativePath && relativePath !== name ? [`UW/${relativePath}`, relativePath] : [];
  const folderCandidates = [
    '',
    'UW',
    'UW/UW',
    'UW INVOICES-RECEIPTS & EXPENSES',
    'UW INVOICES-RECEIPTS & EXPENSES 2 B',
    'UW INVOICES-RECIEPTS & EXPENSES',
    'UW INVOICES-RECIEPTS & EXPENSES 2 B',
    'UW/UW INVOICES-RECEIPTS & EXPENSES',
    'UW/UW INVOICES-RECEIPTS & EXPENSES 2 B',
    'UW/UW INVOICES-RECIEPTS & EXPENSES',
    'UW/UW INVOICES-RECIEPTS & EXPENSES 2 B',
  ];
  const requestedLower = String(requestedPath || '').toLowerCase().replace(/\\/g, '/');
  const orderedFolders = [...folderCandidates].sort((a, b) => {
    const aScore = requestedLower.includes(a.toLowerCase()) ? 2 : 0;
    const bScore = requestedLower.includes(b.toLowerCase()) ? 2 : 0;
    return bScore - aScore;
  });
  for (const candidate of [...pathCandidates, ...orderedFolders.map(folder => `${folder ? `${folder}/` : ''}${name}`)]) {
    const storagePath = candidate;
    const buffer = await loadDocumentFromSupabase(storagePath);
    if (buffer) return { buffer, mimeType: mimeForFile(name), name };
  }
  return null;
};
const recordDocumentInSupabase = async metadata => {
  if (!supabaseConfigured() || !metadata.storagePath) return;
  const response = await fetch(`${supabaseUrl}/rest/v1/uw_documents`, {
    method: 'POST',
    headers: { ...supabaseHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id: metadata.id,
      workspace_id: supabaseWorkspace,
      storage_path: metadata.storagePath,
      name: metadata.name,
      mime_type: metadata.mimeType,
      size_bytes: metadata.size,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Supabase document metadata sync failed (${response.status}).`);
};
const loadSourceFromSupabase = async (requestedPath, requestedName) => {
  if (!supabaseConfigured()) return null;
  const name = path.basename(String(requestedName || requestedPath || '').replace(/\\/g, '/')).trim();
  if (!name) return null;
  const baseParams = {
    workspace_id: `eq.${supabaseWorkspace}`,
    select: 'name,mime_type,storage_path,size_bytes',
    limit: '1',
  };
  const exactParams = new URLSearchParams({ ...baseParams, name: `eq.${name}` });
  let response = await fetch(`${supabaseUrl}/rest/v1/uw_documents?${exactParams.toString()}`, {
    headers: supabaseHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  let [metadata] = response.ok ? await response.json() : [];
  if (!metadata) {
    const stem = name.replace(/\.[^.]+$/, '');
    const stemParams = new URLSearchParams({ ...baseParams, name: `ilike.${stem}%` });
    response = await fetch(`${supabaseUrl}/rest/v1/uw_documents?${stemParams.toString()}`, {
      headers: supabaseHeaders(),
      signal: AbortSignal.timeout(15000),
    });
    [metadata] = response.ok ? await response.json() : [];
  }
  if (metadata?.storage_path) {
    const buffer = await loadDocumentFromSupabase(metadata.storage_path);
    if (buffer) return { buffer, mimeType: metadata.mime_type || 'application/octet-stream', name: metadata.name || name };
  }
  const direct = await loadSourceObjectFromSupabase(requestedPath, name);
  if (direct) return direct;
  const remoteFiles = await listSupabaseStorage();
  const requestedStem = normalizeDocumentName(name.replace(/\.[^.]+$/, ''));
  const requestedLower = String(requestedPath || '').toLowerCase().replace(/\\/g, '/');
  const pathScore = file => {
    const remoteLower = file.storagePath.toLowerCase();
    let score = 0;
    if (requestedLower.includes('invoices-receipts') && remoteLower.includes('invoices-receipts')) score += 4;
    if (requestedLower.includes('invoices-reciepts') && remoteLower.includes('invoices-reciepts')) score += 4;
    if (requestedLower.includes('2 b') && remoteLower.includes('2 b')) score += 2;
    return score;
  };
  const exactRemote = remoteFiles.filter(file => normalizeDocumentName(file.name) === normalizeDocumentName(name)).sort((a, b) => pathScore(b) - pathScore(a))[0];
  const stemRemote = remoteFiles.filter(file => normalizeDocumentName(file.name.replace(/\.[^.]+$/, '')) === requestedStem).sort((a, b) => pathScore(b) - pathScore(a))[0];
  const remote = exactRemote || stemRemote;
  if (!remote) return null;
  const remoteBuffer = await loadDocumentFromSupabase(remote.storagePath);
  return remoteBuffer ? { buffer: remoteBuffer, mimeType: remote.mimeType, name: remote.name } : null;
};
const requireApiKey = requireSessionOrApiKey;
const safeDocumentId = id => /^[a-f0-9]{32}$/.test(String(id || ''));
const safeDocumentPath = id => path.join(documentsRoot, `${id}.bin`);
const sourcePathWithin = candidate => {
  const resolved = path.resolve(candidate);
  const roots = sourceRoots.map(root => path.resolve(root));
  return roots.some(root => resolved === root || resolved.startsWith(`${root}${path.sep}`));
};
const findSourceFile = (requestedPath, requestedName = '') => {
  const rawPath = String(requestedPath || '').trim();
  const name = path.basename(String(requestedName || rawPath).replace(/\\/g, '/'));
  const cacheKey = `${rawPath}\n${name}`;
  if (sourceSearchCache.has(cacheKey)) return sourceSearchCache.get(cacheKey);
  const candidates = [];
  if (rawPath && !/^attached statement$/i.test(rawPath)) {
    const relative = rawPath.replace(/^[A-Za-z]:[\\/]+/i, '').replace(/^UW[\\/]+/i, '').replace(/\\/g, '/').replace(/^\/+/, '');
    sourceRoots.forEach(root => candidates.push(path.join(root, relative)));
  }
  if (name && /\.[a-z0-9]{2,5}$/i.test(name)) {
    sourceRoots.forEach(root => candidates.push(path.join(root, name)));
  }
  const direct = candidates.find(candidate => sourcePathWithin(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (direct) {
    sourceSearchCache.set(cacheKey, direct);
    return direct;
  }
  if (name) {
    if (!sourceFileIndex) {
      sourceFileIndex = new Map();
      sourceStemIndex = new Map();
      const stack = sourceRoots.filter(root => fs.existsSync(root));
      while (stack.length) {
        const directory = stack.pop();
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const candidate = path.join(directory, entry.name);
          if (entry.isDirectory()) stack.push(candidate);
          else if (entry.isFile()) {
            const key = entry.name.toLowerCase();
            if (!sourceFileIndex.has(key)) sourceFileIndex.set(key, candidate);
            const stem = key.replace(/\.[^.]+$/, '');
            if (!sourceStemIndex.has(stem)) sourceStemIndex.set(stem, candidate);
          }
        }
      }
    }
    const indexed = sourceFileIndex.get(name.toLowerCase());
    if (indexed) {
      sourceSearchCache.set(cacheKey, indexed);
      return indexed;
    }
    const stemmed = sourceStemIndex.get(name.toLowerCase().replace(/\.[^.]+$/, ''));
    if (stemmed) {
      sourceSearchCache.set(cacheKey, stemmed);
      return stemmed;
    }
  }
  sourceSearchCache.set(cacheKey, '');
  return '';
};

const cleanStateStore = () => {
  const now = Date.now();
  for (const [key, payload] of stateStore.entries()) {
    if (!payload || !payload.createdAt || now - payload.createdAt > STATE_TTL_MS) {
      stateStore.delete(key);
    }
  }
};

const allowAiRequest = (req) => {
  const now = Date.now();
  for (const [key, entry] of aiRateStore.entries()) {
    if (now - entry.startedAt >= AI_RATE_WINDOW_MS) aiRateStore.delete(key);
  }
  const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const current = aiRateStore.get(key);
  if (!current || now - current.startedAt >= AI_RATE_WINDOW_MS) {
    aiRateStore.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= AI_RATE_LIMIT) return false;
  current.count += 1;
  return true;
};

const normalizeGoogleRedirectUri = (value = '') => {
  const cleaned = String(value).trim();
  if (!cleaned) return cleaned;
  const withoutDoubleSlashes = cleaned.replace(/([^:])\/{2,}/g, '$1/');
  return withoutDoubleSlashes.replace(/\/+$/, '');
};

const getGoogleConfig = (req) => ({
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  redirectUri: normalizeGoogleRedirectUri(
    req && req.get('host') === 'uwwarehouse-2.onrender.com'
      ? 'https://uwwarehouse-2.onrender.com/api/google-drive/callback'
      : process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/api/google-drive/callback`,
  ),
});

const makeOAuthClient = (req) => {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig(req);
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials are not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
};

const escapeDriveQueryValue = (value = '') => String(value).replace(/'/g, "\\'");

const getDriveClient = (tokens = driveState.tokens, req) => {
  if (!tokens) {
    throw new Error('Google Drive is not connected.');
  }
  const client = makeOAuthClient(req);
  client.setCredentials(tokens);
  return google.drive({ version: 'v3', auth: client });
};

const getDriveFileQuery = (fileName = driveState.fileName, folderId = driveState.folderId) => {
  const q = [
    `name='${escapeDriveQueryValue(fileName)}'`,
    'trashed=false',
    folderId ? ` '${escapeDriveQueryValue(folderId)}' in parents` : '',
  ].filter(Boolean).join(' and ');
  return q;
};

const ensureBackupFolder = async (drive, folderName = driveState.backupFolderName || 'UW Accounting Backups') => {
  if (driveState.folderId) {
    return { id: driveState.folderId };
  }

  const query = `name='${escapeDriveQueryValue(folderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const existing = await drive.files.list({
    q: query,
    pageSize: 1,
    fields: 'files(id,name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const folder = existing.data.files && existing.data.files[0];
  if (folder) {
    driveState.folderId = folder.id;
    return folder;
  }

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id,name',
    supportsAllDrives: true,
  });

  driveState.folderId = created.data.id || '';
  return created.data;
};

const normalizeBackupData = (payload) => {
  if (payload && typeof payload === 'object' && 'data' in payload && payload.data && typeof payload.data === 'object') {
    return payload.data;
  }
  return payload && typeof payload === 'object' ? payload : {};
};

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.disable('x-powered-by');
app.use('/api', requireCsrf);
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (isProduction) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use('/api', (_, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

ensureStorage();
const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, callback) => callback(null, uploadTempRoot),
    filename: (_, file, callback) => callback(null, `${process.pid}-${crypto.randomBytes(12).toString('hex')}-${path.basename(file.originalname || 'upload')}`),
  }),
  limits: { fileSize: maxDocumentBytes, files: 1 },
});
const cleanupUploadTemp = () => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const name of fs.readdirSync(uploadTempRoot)) {
    const file = path.join(uploadTempRoot, name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
    } catch (error) {
      console.warn('Temporary upload cleanup skipped:', error.message);
    }
  }
};
cleanupUploadTemp();
const uploadCleanupTimer = setInterval(cleanupUploadTemp, 15 * 60 * 1000);
uploadCleanupTimer.unref();

const validCollectionKeys = ['invoices', 'quotes', 'expenses', 'receipts', 'documents', 'scannedDocuments', 'fnbStatements'];
const validateStateData = data => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'State data must be an object.';
  if (JSON.stringify(data).length > 40 * 1024 * 1024) return 'State data exceeds the 40 MB limit.';
  for (const key of validCollectionKeys) {
    if (data[key] !== undefined && !Array.isArray(data[key])) return `${key} must be an array.`;
  }
  return '';
};

app.get('/api/auth/config', (_, res) => res.json({
  configured: authConfigured(),
  methods: authConfigured() ? ['email-password'] : [],
  users: Object.entries(authUsers)
    .filter(([, user]) => user && typeof user === 'object' && typeof user.passwordHash === 'string' && user.passwordHash.startsWith('scrypt$'))
    .map(([email, user]) => ({ email, name: String(user.name || email), role: String(user.role || 'Operator') })),
}));
app.get('/api/auth/session', async (req, res) => {
  const token = sessionTokenFromRequest(req);
  const session = sessionFromRequest(req) || await loadDurableSession(token).catch(() => null);
  return res.json({ authenticated: Boolean(session), user: session ? { email: session.email, name: session.name, role: session.role } : null, csrfToken: session?.csrfToken || '' });
});
app.post('/api/auth/login', async (req, res) => {
  const identifier = String(req.body?.email || req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const now = Date.now();
  const prior = authAttempts.get(identifier) || { count: 0, windowStartedAt: now };
  if (now - prior.windowStartedAt > 15 * 60 * 1000) { prior.count = 0; prior.windowStartedAt = now; }
  prior.count += 1; authAttempts.set(identifier, prior);
  if (prior.count > 10) return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  const account = getAuthUser(identifier);
  const user = account?.user;
  if (!user || !(await verifyPassword(password, user.passwordHash))) return res.status(401).json({ error: 'Invalid profile or password.' });
  const email = account.key;
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  const session = { email, name: String(user.name || email), role: String(user.role || 'Operator'), csrfToken, expiresAt: now + AUTH_SESSION_TTL_MS };
  authSessions.set(token, session);
  try {
    await persistSession(token, session);
  } catch (error) {
    console.error('Durable session could not be saved:', error.message);
    return res.status(503).json({ error: 'Sign-in could not be completed because durable session storage is unavailable.' });
  }
  res.set('Set-Cookie', `uw_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_SESSION_TTL_MS / 1000}${isProduction ? '; Secure' : ''}`);
  return res.json({ ok: true, user: { email, name: String(user.name || email), role: String(user.role || 'Operator') }, csrfToken });
});
app.post('/api/auth/logout', async (req, res) => {
  const token = sessionTokenFromRequest(req);
  if (token) authSessions.delete(token);
  await deleteDurableSession(token).catch(error => console.error('Durable session cleanup failed:', error.message));
  res.set('Set-Cookie', 'uw_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return res.json({ ok: true });
});

app.get('/api/state', requireApiKey, async (req, res) => {
  await bootstrapReady;
  const snapshot = ensureStorage();
  res.json(snapshot);
});

app.put('/api/state', requireApiKey, async (req, res) => {
  await bootstrapReady;
  const current = ensureStorage();
  const expectedRevision = req.body && req.body.revision !== undefined ? Number(req.body.revision) : current.revision;
  if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) {
    return res.status(409).json({ error: 'State revision conflict.', snapshot: current });
  }
  const data = req.body && Object.prototype.hasOwnProperty.call(req.body, 'data') ? req.body.data : req.body;
  const validationError = validateStateData(data);
  if (validationError) return res.status(400).json({ error: validationError });
  try {
    const next = { version: stateVersion, revision: current.revision + 1, updatedAt: new Date().toISOString(), data };
    await queueStateWrite(next);
    res.json(next);
  } catch (error) {
    console.error('State write failed:', error);
    res.status(500).json({ error: 'State could not be saved.' });
  }
});

app.get('/api/state/backup', requireApiKey, (req, res) => {
  res.download(stateFile, 'uw-state-backup.json');
});

app.post('/api/state/restore', requireApiKey, async (req, res) => {
  const current = ensureStorage();
  const incoming = req.body && req.body.snapshot ? req.body.snapshot : req.body;
  if (!incoming || incoming.version !== stateVersion || !incoming.data || typeof incoming.data !== 'object') {
    return res.status(400).json({ error: 'A valid versioned state snapshot is required.' });
  }
  if (req.body.revision !== undefined && Number(req.body.revision) !== current.revision) {
    return res.status(409).json({ error: 'State revision conflict.', snapshot: current });
  }
  try {
    const next = { version: stateVersion, revision: current.revision + 1, updatedAt: new Date().toISOString(), data: incoming.data };
    await queueStateWrite(next);
    res.json(next);
  } catch (error) {
    res.status(500).json({ error: 'State restore failed.' });
  }
});

app.post('/api/documents', requireApiKey, (req, res) => {
  upload.single('file')(req, res, async error => {
    if (error) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: status === 413 ? 'Document is too large.' : error.message });
    }
    if (!req.file) return res.status(400).json({ error: 'A file is required.' });
    if (!allowedDocumentTypes.has(req.file.mimetype)) return res.status(415).json({ error: 'Unsupported document type.' });
    const signature = await documentBufferPrefix(req.file.path).catch(() => null);
    if (!hasDocumentSignature(signature, req.file.mimetype)) {
      await fs.promises.rm(req.file.path, { force: true }).catch(() => {});
      return res.status(415).json({ error: 'The file signature does not match its declared document type.' });
    }
    const id = crypto.randomBytes(16).toString('hex');
    const metadata = { id, name: path.basename(req.file.originalname || 'document'), size: req.file.size, mimeType: req.file.mimetype, createdAt: new Date().toISOString(), url: `/api/documents/${id}` };
    let storagePath = '';
    try {
      await fs.promises.copyFile(req.file.path, safeDocumentPath(id), fs.constants.COPYFILE_EXCL);
      storagePath = await syncDocumentToSupabase(id, req.file);
      if (storagePath) metadata.storagePath = storagePath;
      await recordDocumentInSupabase(metadata);
      await stateWrite;
      const latest = ensureStorage();
      await queueStateWrite({
        version: stateVersion,
        revision: latest.revision + 1,
        updatedAt: new Date().toISOString(),
        data: { ...latest.data, documents: [...(latest.data.documents || []), metadata] },
      });
      res.status(201).json(metadata);
    } catch (writeError) {
      try { fs.rmSync(safeDocumentPath(id), { force: true }); } catch (_) {}
      await removeDocumentFromSupabase(storagePath);
      console.error('Document upload failed:', writeError);
      res.status(500).json({ error: 'Document could not be stored.' });
    } finally {
      await fs.promises.rm(req.file.path, { force: true }).catch(error => console.warn('Temporary upload cleanup failed:', error.message));
    }
  });
});

app.get('/api/documents', requireApiKey, (req, res) => {
  res.json((ensureStorage().data.documents || []).map(doc => ({ ...doc, url: `/api/documents/${doc.id}` })));
});

app.get('/api/documents/catalog', requireApiKey, async (req, res) => {
  try {
    const local = ensureStorage().data.documents || [];
    const remote = await listSupabaseStorage();
    return res.json({
      configured: supabaseConfigured(),
      bucket: supabaseDocumentBucket,
      files: remote.map(file => ({ ...file, url: `/api/source-file?name=${encodeURIComponent(file.name)}` })),
      localCount: local.length,
      remoteCount: remote.length,
      storageError: remoteStorageCache.error || null,
    });
  } catch (error) {
    console.error('Document catalog sync failed:', error.message);
    return res.status(502).json({ error: 'Document storage catalog could not be loaded.' });
  }
});

app.get('/api/documents/:id', requireApiKey, async (req, res) => {
  await bootstrapReady;
  const id = String(req.params.id || '');
  if (!safeDocumentId(id)) return res.status(400).json({ error: 'Invalid document id.' });
  const metadata = (ensureStorage().data.documents || []).find(doc => doc.id === id);
  const file = safeDocumentPath(id);
  if (!metadata) return res.status(404).json({ error: 'Document not found.' });
  res.type(metadata.mimeType || 'application/octet-stream');
  res.set('Content-Disposition', `inline; filename="${String(metadata.name).replace(/["\r\n]/g, '_')}"`);
  res.set('Cache-Control', 'private, max-age=600, stale-while-revalidate=86400');
  if (fs.existsSync(file)) return res.sendFile(file);
  const remote = await loadDocumentFromSupabase(metadata.storagePath);
  if (!remote) return res.status(404).json({ error: 'Document content is not available.' });
  return res.send(remote);
});

app.post('/api/ai/review-document', requireApiKey, async (req, res) => {
  if (!allowAiRequest(req)) return res.status(429).json({ error: 'AI request limit reached. Please try again later.' });
  const id = String(req.body?.id || '').trim();
  const name = String(req.body?.name || '').trim();
  const requestedPath = String(req.body?.path || '').trim();
  let filePath = '';
  let remoteDocument = null;
  let fileName = name || path.basename(requestedPath);
  if (safeDocumentId(id)) {
    const metadata = (ensureStorage().data.documents || []).find(doc => doc.id === id);
    if (metadata) {
      filePath = safeDocumentPath(id);
      fileName = metadata.name || fileName;
    }
  }
  if (!filePath || !fs.existsSync(filePath)) filePath = findSourceFile(requestedPath, fileName);
  if (!filePath || !fs.existsSync(filePath)) remoteDocument = await loadSourceFromSupabase(requestedPath, fileName);
  if (!filePath && !remoteDocument) return res.status(404).json({ error: 'The source document is not available in local sources or Supabase Storage.' });
  const stat = filePath ? fs.statSync(filePath) : null;
  if (stat && !stat.isFile()) return res.status(400).json({ error: 'The source path is not a file.' });
  const documentSize = stat ? stat.size : remoteDocument.buffer.length;
  if (documentSize > 15 * 1024 * 1024) return res.status(413).json({ error: 'This document is too large for AI review. Open it manually or upload a smaller scan.' });
  const mimeType = filePath ? mimeForFile(filePath) : remoteDocument.mimeType;
  if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(mimeType)) {
    return res.status(415).json({ error: 'Gemini review supports PDF and image receipts/scans.' });
  }
  try {
    const result = await callGeminiDocumentReview({ buffer: filePath ? fs.readFileSync(filePath) : remoteDocument.buffer, mimeType, name: fileName || path.basename(filePath || remoteDocument.name) });
    return res.json({ ...result, sourceName: path.basename(filePath || remoteDocument.name) });
  } catch (error) {
    return res.status(error.statusCode || 502).json({ error: error.message || 'Gemini document review failed.' });
  }
});

app.post('/api/gemini/review-document', requireApiKey, (req, res, next) => {
  req.url = '/api/ai/review-document';
  return app._router.handle(req, res, next);
});

const getAiProvider = () => {
  const configuredProvider = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (configuredProvider) return configuredProvider;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.TYPESAFE_API_KEY) return 'typesafe';
  return 'gemini';
};

const getAiModel = (providerOverride) => {
  const provider = String(providerOverride || getAiProvider()).trim().toLowerCase();
  if (provider === 'typesafe') return process.env.TYPESAFE_MODEL || process.env.AI_MODEL || 'gpt-4o-mini';
  const configured = process.env.GEMINI_MODEL || process.env.AI_MODEL || 'gemini-3.6-flash';
  return configured;
};

const getGeminiModelAttempts = (configuredModel) => {
  const attempts = [];
  const preferred = String(configuredModel || '').trim();
  const validFallbacks = [
    'gemini-3.6-flash',
    'gemini-flash-latest',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
  ];

  if (preferred) attempts.push(preferred);
  for (const candidate of validFallbacks) {
    if (candidate !== preferred) attempts.push(candidate);
  }

  if (!attempts.length) attempts.push('gemini-3.6-flash');
  return [...new Set(attempts)];
};

const extractAiText = (payload, provider) => {
  if (provider === 'typesafe') {
    const candidates = payload?.choices || payload?.output || [];
    const firstMessage = candidates?.[0]?.message?.content || candidates?.[0]?.content || '';
    if (Array.isArray(firstMessage)) {
      return firstMessage.map(part => typeof part === 'string' ? part : part?.text || '').join('').trim();
    }
    if (typeof firstMessage === 'string') return firstMessage.trim();
    if (payload?.output && Array.isArray(payload.output)) {
      return payload.output
        .map(block => block?.content || [])
        .flat()
        .map(part => typeof part === 'string' ? part : part?.text || '')
        .join('')
        .trim();
    }
  }

  return (payload?.candidates || [])
    .flatMap(candidate => candidate.content?.parts || [])
    .map(part => part.text || '')
    .join('')
    .trim();
};

const parseJsonObject = text => {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Gemini returned an invalid extraction response.');
    return JSON.parse(match[0]);
  }
};

const callGeminiChat = async (prompt) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini is not configured. Set GEMINI_API_KEY on the server.');
  }

  const modelAttempts = getGeminiModelAttempts(getAiModel('gemini'));
  let lastError = null;

  for (const model of modelAttempts) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(30000),
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
          }),
        },
      );

      const payload = await response.json();
      if (!response.ok) {
        const message = payload?.error?.message || 'Gemini request failed.';
        const isRetiredModelError = /no longer available|not found|404|Model not found/i.test(message);
        if (isRetiredModelError && model !== modelAttempts[modelAttempts.length - 1]) {
          lastError = new Error(message);
          continue;
        }
        const error = new Error(message);
        error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
        throw error;
      }

      const text = extractAiText(payload, 'gemini');
      if (!text) throw new Error('Gemini returned no text.');
      return { text, provider: 'gemini', model };
    } catch (error) {
      lastError = error;
      const shouldRetry = error?.message && /no longer available|not found|404|Model not found/i.test(error.message);
      if (shouldRetry && model !== modelAttempts[modelAttempts.length - 1]) {
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('Gemini request failed.');
};

const mimeForFile = file => {
  const extension = path.extname(file).toLowerCase();
  return ({
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })[extension] || 'application/octet-stream';
};

const callGeminiDocumentReview = async ({ buffer, mimeType, name }) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini is not configured. Set GEMINI_API_KEY on the server.');
  const prompt = [
    'You are reviewing one business receipt or invoice for UW Upholstery Warehouse.',
    'Extract only what is visibly supported by the document. Never guess or invent missing values.',
    'Return exactly one JSON object with these keys:',
    '{"documentDate":"YYYY-MM-DD or null","merchant":"string or null","amountPaid":number or null,"currency":"string or null","documentType":"receipt|invoice|other","invoiceNumber":"string or null","confidence":number from 0 to 1,"notes":"short string"}',
    `Filename: ${name}`,
    'amountPaid must be the total amount paid/charged shown on the document, not a line-item amount. If the document is unreadable, use null and explain in notes.',
  ].join('\n');
  const modelAttempts = getGeminiModelAttempts(getAiModel('gemini'));
  let lastError;
  for (const model of modelAttempts) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(60000),
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
              ],
            }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json' },
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload?.error?.message || 'Gemini document review failed.');
        if (/not found|no longer available|404|model/i.test(error.message) && model !== modelAttempts[modelAttempts.length - 1]) {
          lastError = error;
          continue;
        }
        error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
        throw error;
      }
      const text = extractAiText(payload, 'gemini');
      const extraction = parseJsonObject(text);
      return {
        documentDate: /^\d{4}-\d{2}-\d{2}$/.test(String(extraction.documentDate || '')) ? extraction.documentDate : null,
        merchant: extraction.merchant ? String(extraction.merchant).trim().slice(0, 200) : null,
        amountPaid: Number.isFinite(Number(extraction.amountPaid)) ? Number(extraction.amountPaid) : null,
        currency: extraction.currency ? String(extraction.currency).trim().slice(0, 12) : null,
        documentType: ['receipt', 'invoice', 'other'].includes(extraction.documentType) ? extraction.documentType : 'other',
        invoiceNumber: extraction.invoiceNumber ? String(extraction.invoiceNumber).trim().slice(0, 100) : null,
        confidence: Math.max(0, Math.min(1, Number(extraction.confidence) || 0)),
        notes: extraction.notes ? String(extraction.notes).trim().slice(0, 500) : '',
        provider: 'gemini',
        model,
      };
    } catch (error) {
      lastError = error;
      if (!/not found|no longer available|404|model/i.test(String(error.message || '')) || model === modelAttempts[modelAttempts.length - 1]) throw error;
    }
  }
  throw lastError || new Error('Gemini document review failed.');
};

const callTypesafeChat = async (prompt) => {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw new Error('TypeSafe is not configured. Set TYPESAFE_API_KEY on the server.');
  }

  const model = getAiModel('typesafe');
  const candidateUrls = [
    process.env.TYPESAFE_API_URL,
    'https://api.typesafe.ai/v1/chat/completions',
    'https://typesafe.ai/api/v1/chat/completions',
    'https://api.type-safe.ai/v1/chat/completions',
  ].filter(Boolean);

  let lastHttpError = null;
  let lastNetworkError = null;
  for (const url of [...new Set(candidateUrls)]) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 2048,
          stream: false,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        const message = payload?.error?.message || payload?.message || payload?.detail || `TypeSafe request failed (${response.status}).`;
        lastHttpError = new Error(message);
        lastHttpError.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
        continue;
      }

      const text = extractAiText(payload, 'typesafe');
      if (!text) {
        const err = new Error('TypeSafe returned no text.');
        err.statusCode = 502;
        throw err;
      }

      return { text, provider: 'typesafe', model };
    } catch (error) {
      if (!lastHttpError) {
        lastNetworkError = error;
      }
    }
  }

  if (lastHttpError) {
    throw lastHttpError;
  }
  if (lastNetworkError) {
    throw lastNetworkError;
  }

  throw new Error('TypeSafe request failed.');
};

const normalizeProviderOverride = (value) => {
  const provider = String(value || '').trim().toLowerCase();
  if (provider && !['gemini', 'typesafe'].includes(provider)) {
    throw new Error('Unsupported AI provider. Use "gemini" or "typesafe".');
  }
  return provider || getAiProvider();
};

const generateAiText = async (prompt, providerOverride) => {
  const provider = normalizeProviderOverride(providerOverride);
  if (provider === 'typesafe') return callTypesafeChat(prompt);
  return callGeminiChat(prompt);
};

app.get('/api/ai/config', (_, res) => {
  const provider = getAiProvider();
  const configured = Boolean(process.env.GEMINI_API_KEY || process.env.TYPESAFE_API_KEY);
  res.json({
    configured,
    provider,
    model: getAiModel(),
    providers: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      typesafe: Boolean(process.env.TYPESAFE_API_KEY),
    },
  });
});

app.get('/api/gemini/config', (_, res) => {
  const provider = getAiProvider();
  res.json({
    configured: Boolean(process.env.GEMINI_API_KEY || process.env.TYPESAFE_API_KEY),
    provider,
    model: getAiModel(),
  });
});

app.post('/api/ai/generate', requireApiKey, async (req, res) => {
  if (!allowAiRequest(req)) {
    return res.status(429).json({ error: 'AI request limit reached. Please try again later.' });
  }
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const provider = req.body?.provider;
  if (!prompt) return res.status(400).json({ error: 'A prompt is required.' });
  if (prompt.length > 20000) return res.status(413).json({ error: 'Prompt is too long.' });

  try {
    const result = await generateAiText(prompt, provider);
    return res.json(result);
  } catch (error) {
    return res.status(error.statusCode || 502).json({ error: error.message || 'AI request failed.' });
  }
});

app.post('/api/gemini/generate', requireApiKey, async (req, res) => {
  if (!allowAiRequest(req)) {
    return res.status(429).json({ error: 'AI request limit reached. Please try again later.' });
  }
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const provider = req.body?.provider;
  if (!prompt) return res.status(400).json({ error: 'A prompt is required.' });
  if (prompt.length > 20000) return res.status(413).json({ error: 'Prompt is too long.' });

  try {
    const result = await generateAiText(prompt, provider);
    return res.json(result);
  } catch (error) {
    return res.status(error.statusCode || 502).json({ error: error.message || 'AI request failed.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'UW Accounting server is running',
    timestamp: new Date().toISOString(),
    googleConfigured: Boolean(getGoogleConfig(req).clientId && getGoogleConfig(req).clientSecret),
    driveConnected: driveState.connected,
    durableStore: Boolean(stateSnapshot),
    documentsDir: documentsRoot,
    supabaseConfigured: supabaseConfigured(),
  });
});

app.get('/api/supabase/status', requireApiKey, async (_, res) => {
  if (!supabaseConfigured()) return res.status(503).json({ configured: false, connected: false, error: 'Supabase is not configured on the server.' });
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/${encodeURIComponent(supabaseStateTable)}?select=workspace_id&workspace_id=eq.${encodeURIComponent(supabaseWorkspace)}&limit=1`,
      { headers: supabaseHeaders(), signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) return res.status(502).json({ configured: true, connected: false, error: `Supabase returned ${response.status}.` });
    return res.json({ configured: true, connected: true, workspace: supabaseWorkspace, stateTable: supabaseStateTable, documentBucket: supabaseDocumentBucket });
  } catch (error) {
    return res.status(502).json({ configured: true, connected: false, error: error.message || 'Supabase connection failed.' });
  }
});

app.get('/api/ready', (req, res) => {
  const google = getGoogleConfig(req);
  const checks = {
    server: true,
    googleOAuth: Boolean(google.clientId && google.clientSecret && google.redirectUri),
    aiProvider: Boolean(process.env.GEMINI_API_KEY || process.env.TYPESAFE_API_KEY),
    sourceStorage: sourceRoots.some(root => fs.existsSync(root)) || fs.existsSync(documentsRoot),
    serverAuth: Boolean(process.env.UW_API_KEY),
    durableStore: Boolean(stateSnapshot && fs.existsSync(stateFile)),
    documentStorage: fs.existsSync(documentsRoot),
    persistentStorage: !isProduction || (!dataRootFallback && !documentsRootFallback),
    bootstrap: bootstrapComplete,
    apiAuth: !isProduction || Boolean(process.env.UW_API_KEY),
    operatorAuth: !isProduction || authConfigured(),
    durableAuth: !isProduction || durableAuthConfigured(),
    supabase: !isProduction || supabaseConfigured(),
  };
  const ready = checks.server && (!isProduction || (
    checks.googleOAuth &&
    checks.sourceStorage &&
    checks.apiAuth &&
    checks.operatorAuth &&
    checks.durableAuth &&
    checks.durableStore &&
    checks.documentStorage &&
    checks.persistentStorage &&
    checks.bootstrap &&
    checks.supabase
  ));
  return res.status(ready ? 200 : 503).json({
    ready,
    environment: process.env.NODE_ENV || 'development',
    checks,
    message: ready
      ? 'UW Accounting server is ready for application traffic.'
      : 'Production configuration is incomplete. Review the failed readiness checks.',
  });
});

app.get('/api/google-drive/config', (req, res) => {
  const config = getGoogleConfig(req);
  res.json({
    clientConfigured: Boolean(config.clientId && config.clientSecret),
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    expectedRedirectUris: [
      'http://localhost:8080/api/google-drive/callback',
      'https://uwwarehouse-2.onrender.com/api/google-drive/callback',
    ],
    state: { connected: driveState.connected, accountEmail: driveState.accountEmail, fileName: driveState.fileName, folderId: driveState.folderId, fileId: driveState.fileId, lastSync: driveState.lastSync },
  });
});

app.get('/api/google-drive/auth', (req, res) => {
  const config = getGoogleConfig(req);
  if (!config.clientId || !config.clientSecret) {
    return res.status(503).json({ error: 'Google OAuth is not configured on the backend.' });
  }
  cleanStateStore();
  const state = crypto.randomBytes(16).toString('hex');
  stateStore.set(state, { createdAt: Date.now() });
  const oauth2Client = makeOAuthClient(req);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: ['https://www.googleapis.com/auth/drive.file'],
    state,
  });
  return res.redirect(authUrl);
});

app.get('/api/google-drive/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) {
      return res.status(400).send(`<html><body><h2>Google OAuth failed</h2><p>${String(error)}</p><p><a href="/">Return to app</a></p></body></html>`);
    }
    if (!code) {
      return res.status(400).send('<html><body><h2>Missing Google OAuth code.</h2><p>Please retry the connection.</p><p><a href="/">Return to app</a></p></body></html>');
    }
    if (!state || !stateStore.has(String(state))) {
      cleanStateStore();
      if (!state) {
        return res.status(400).send('<html><body><h2>Invalid Google OAuth state.</h2><p>The Google callback did not return a valid security state. This usually happens when the redirect URL is wrong or the OAuth flow was restarted.</p><p><a href="/">Return to app</a></p></body></html>');
      }
      return res.status(400).send('<html><body><h2>Invalid Google OAuth state.</h2><p>The security token expired or was lost. Please start the Google Drive sign-in again from the app.</p><p><a href="/">Return to app</a></p></body></html>');
    }

    stateStore.delete(String(state));
    const oauth2Client = makeOAuthClient(req);
    const { tokens } = await oauth2Client.getToken(String(code));
    oauth2Client.setCredentials(tokens);
    driveState.tokens = tokens;
    driveState.connected = true;
    driveState.lastSync = new Date().toISOString();

    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const response = await drive.about.get({ fields: 'user' });
    driveState.accountEmail = response.data.user?.emailAddress || '';
    await persistDriveTokens();

    return res.send(`<!doctype html>
      <html><head><meta charset="utf-8" /></head>
      <body style="font-family:sans-serif;background:#0b1220;color:#f8fafc;padding:30px;display:grid;place-items:center;min-height:100vh;">
        <div style="max-width:520px;background:#111827;border:1px solid #374151;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,0.25);text-align:center;">
          <h2 style="margin-top:0;">Google Drive connected</h2>
          <p>${driveState.accountEmail || 'Your account is now linked.'}</p>
          <p style="color:#cbd5e1;">This window will close and return you to the application.</p>
          <script>
            const returnToApp = () => {
              if (window.opener && !window.opener.closed) {
                window.opener.postMessage({ type: 'google-drive-auth-success', email: ${JSON.stringify(driveState.accountEmail || '')} }, window.location.origin);
                window.close();
                return;
              }
              window.location.replace('/');
            };
            setTimeout(returnToApp, 1200);
          </script>
        </div>
      </body></html>
    `);
  } catch (error) {
    console.error('Google OAuth callback failed:', error);
    return res.status(500).send(`<html><body><h2>Google Drive setup failed</h2><p>${String(error.message || error)}</p><p><a href="/">Return to app</a></p></body></html>`);
  }
});

app.post('/api/google-drive/disconnect', requireApiKey, (_, res) => {
  driveState.tokens = null;
  driveState.connected = false;
  driveState.accountEmail = '';
  driveState.fileId = '';
  driveState.lastSync = null;
  deleteSupabaseRows(supabaseSecretTable, `workspace_id=eq.${encodeURIComponent(supabaseWorkspace)}&secret_name=eq.google_drive_tokens`)
    .catch(error => console.error('Durable Google Drive credential cleanup failed:', error.message));
  return res.json({ ok: true, message: 'Google Drive disconnected.' });
});

app.get('/api/google-drive/status', requireApiKey, (_, res) => {
  return res.json({
    ok: true,
    connected: driveState.connected,
    accountEmail: driveState.accountEmail,
    fileName: driveState.fileName,
    folderId: driveState.folderId,
    fileId: driveState.fileId,
    lastSync: driveState.lastSync,
  });
});

app.post('/api/google-drive/sync', requireApiKey, async (req, res) => {
  try {
    const config = getGoogleConfig(req);
    if (!config.clientId || !config.clientSecret) {
      return res.status(503).json({ error: 'Google OAuth is not configured on the backend.' });
    }
    if (!driveState.tokens) {
      return res.status(401).json({ error: 'Google Drive is not connected.' });
    }

    const payload = normalizeBackupData(req.body);
    const fileName = String(req.body?.fileName || driveState.fileName || 'UW_ACCOUNTING_BACKUP.json');
    const folderId = String(req.body?.folderId || driveState.folderId || '');
  const backupFolderName = String(req.body?.backupFolderName || driveState.backupFolderName || 'UW Accounting Backups');
  const drive = getDriveClient(undefined, req);

  const backupFolder = await ensureBackupFolder(drive, backupFolderName);
  const effectiveFolderId = folderId || backupFolder.id || driveState.folderId || '';

  let fileId = req.body?.fileId || driveState.fileId || '';
  if (!fileId) {
    const q = getDriveFileQuery(fileName, effectiveFolderId);
    const listResponse = await drive.files.list({
      q,
      pageSize: 1,
      fields: 'files(id,name,modifiedTime)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    fileId = listResponse.data.files?.[0]?.id || '';
  }

  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    ...(effectiveFolderId ? { parents: [effectiveFolderId] } : {}),
  };

  const uploadPayload = JSON.stringify(payload || {});
  const response = fileId
    ? await drive.files.update({
        fileId,
        requestBody: metadata,
        media: { mimeType: 'application/json', body: uploadPayload },
        fields: 'id,name,modifiedTime',
        supportsAllDrives: true,
      })
    : await drive.files.create({
        requestBody: metadata,
        media: { mimeType: 'application/json', body: uploadPayload },
        fields: 'id,name,modifiedTime',
        supportsAllDrives: true,
      });

  driveState.fileId = response.data.id || fileId;
  driveState.fileName = response.data.name || fileName;
  driveState.folderId = effectiveFolderId;
  driveState.lastSync = new Date().toISOString();

  return res.json({
    ok: true,
    fileId: driveState.fileId,
    fileName: driveState.fileName,
    folderId: driveState.folderId,
    lastSync: driveState.lastSync,
    connected: true,
  });
} catch (error) {
  console.error('Google Drive sync failed:', error);
  return res.status(500).json({
    error: error.message || 'Google Drive sync failed.',
  });
}
});

app.post('/api/google-drive/restore', requireApiKey, async (req, res) => {
  try {
    const config = getGoogleConfig(req);
    if (!config.clientId || !config.clientSecret) {
      return res.status(503).json({ error: 'Google OAuth is not configured on the backend.' });
    }
    if (!driveState.tokens) {
      return res.status(401).json({ error: 'Google Drive is not connected.' });
    }

    const fileName = String(req.body?.fileName || driveState.fileName || 'UW_ACCOUNTING_BACKUP.json');
    const folderId = String(req.body?.folderId || driveState.folderId || '');
    const backupFolderName = String(req.body?.backupFolderName || driveState.backupFolderName || 'UW Accounting Backups');
    const drive = getDriveClient(undefined, req);
    const backupFolder = await ensureBackupFolder(drive, backupFolderName);
    const effectiveFolderId = folderId || backupFolder.id || driveState.folderId || '';
    const q = getDriveFileQuery(fileName, effectiveFolderId);
    const listResponse = await drive.files.list({
      q,
      pageSize: 1,
      fields: 'files(id,name,modifiedTime)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const match = listResponse.data.files?.[0];
    if (!match) {
      return res.status(404).json({ error: 'No matching Google Drive backup was found.' });
    }

    const download = await drive.files.get({ fileId: match.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
    const raw = Buffer.from(download.data).toString('utf8');
    const data = JSON.parse(raw);
    driveState.fileId = match.id;
    driveState.fileName = match.name || fileName;
    driveState.folderId = effectiveFolderId;
    driveState.lastSync = new Date().toISOString();

    return res.json({ ok: true, data, fileId: match.id, fileName: match.name || fileName });
  } catch (error) {
    console.error('Google Drive restore failed:', error);
    return res.status(500).json({
      error: error.message || 'Google Drive restore failed.',
    });
  }
});

app.get('/api/source-file', requireApiKey, (req, res) => {
  const file = findSourceFile(req.query.path, req.query.name);
  res.set('Cache-Control', 'private, max-age=600, stale-while-revalidate=86400');
  if (file) return res.sendFile(file);
  loadSourceFromSupabase(req.query.path, req.query.name).then(remote => {
    if (!remote) return res.status(404).json({ error: 'Document is not available in local sources or managed cloud storage.' });
    res.type(remote.mimeType);
    res.set('Content-Disposition', `inline; filename="${String(remote.name).replace(/["\r\n]/g, '_')}"`);
    res.set('Cache-Control', 'private, max-age=600, stale-while-revalidate=86400');
    return res.send(remote.buffer);
  }).catch(error => {
    console.error('Remote source lookup failed:', error.message);
    return res.status(502).json({ error: 'Managed document storage could not be reached.' });
  });
});

app.get('/__source/*', requireApiKey, (req, res) => {
  const relativePath = decodeURIComponent(req.params[0] || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const safePath = relativePath.split('/').filter(Boolean).filter(part => part !== '..' && part !== '.').join('/');
  const bundledCandidate = path.join(rootDir, '__source', safePath);
  const localCandidate = path.join(sourceRoot, safePath);
  const candidate = fs.existsSync(bundledCandidate) ? bundledCandidate : (fs.existsSync(localCandidate) ? localCandidate : findSourceFile('', path.basename(safePath)));

  if (safePath && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return res.sendFile(candidate);
  }

  const fileName = safePath.split('/').pop() || 'document';
  return res.type('html').send(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${fileName}</title>
        <style>
          body { font-family: sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; min-height: 100vh; display: grid; place-items: center; }
          .card { width: min(560px, 92vw); background: #111827; border: 1px solid #334155; border-radius: 16px; padding: 28px; box-shadow: 0 20px 40px rgba(0,0,0,0.2); }
          .badge { display: inline-block; background: #fbbf24; color: #111827; border-radius: 999px; padding: 6px 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 14px; }
          a { color: #fbbf24; }
          p { color: #cbd5e1; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="badge">Document preview</div>
          <h2 style="margin-top:0">${fileName}</h2>
          <p>This file is not available in the deployed app or it was not bundled into the static source tree.</p>
          <p>Use the original copy from the local system or upload the file into the app to render it here. The application keeps the document record in the local database, but the browser cannot access a machine-local D:\UW path from a hosted deployment.</p>
          <a href="/">Return to the UW Accounting system</a>
        </div>
      </body>
    </html>`);
});

app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'API route not found.',
    path: req.path,
    method: req.method,
    recovery: 'Check the deployed app version and API route spelling.',
  });
});

app.use(express.static(rootDir, { index: 'index.html' }));

app.get('*', (_, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

app.use((error, req, res, next) => {
  console.error('Unhandled request error:', error);
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({
      error: status === 500 ? 'The server could not complete that request.' : String(error.message || 'Request failed.'),
      recovery: status === 500 ? 'Try again. If the problem persists, check the server logs and readiness endpoint.' : 'Correct the request and try again.',
    });
  }
  return res.status(status).send('The server could not complete that request.');
});

const server = app.listen(PORT, HOST, () => {
  console.log(`UW Accounting app and API running at http://${HOST}:${PORT}`);
  console.log('Google OAuth backend status:', getGoogleConfig().clientId && getGoogleConfig().clientSecret ? 'configured' : 'missing env vars');
  if (supabaseConfigured()) {
    bootstrapComplete = false;
    bootstrapReady = Promise.all([restoreSnapshotFromSupabase(), restoreDriveTokens()]).then(() => {
      bootstrapComplete = true;
      console.log('Supabase state sync: configured');
    }).catch(error => {
      bootstrapComplete = true;
      console.error('Supabase state bootstrap failed:', error.message);
    });
  } else {
    console.log('Supabase state sync: not configured');
  }
});

const shutdown = (signal) => {
  console.log(`Received ${signal}; shutting down.`);
  process.exit(0);
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server, ensureStorage, stateFile, documentsRoot };
