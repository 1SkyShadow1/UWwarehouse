require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');

const app = express();
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const rootDir = __dirname;
const stateStore = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;
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

const cleanStateStore = () => {
  const now = Date.now();
  for (const [key, payload] of stateStore.entries()) {
    if (!payload || !payload.createdAt || now - payload.createdAt > STATE_TTL_MS) {
      stateStore.delete(key);
    }
  }
};

const normalizeGoogleRedirectUri = (value = '') => {
  const cleaned = String(value).trim();
  if (!cleaned) return cleaned;
  const withoutDoubleSlashes = cleaned.replace(/([^:])\/{2,}/g, '$1/');
  return withoutDoubleSlashes.replace(/\/+$/, '');
};

const getGoogleConfig = () => ({
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  redirectUri: normalizeGoogleRedirectUri(process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/api/google-drive/callback`),
});

const makeOAuthClient = () => {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig();
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials are not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
};

const escapeDriveQueryValue = (value = '') => String(value).replace(/'/g, "\\'");

const getDriveClient = (tokens = driveState.tokens) => {
  if (!tokens) {
    throw new Error('Google Drive is not connected.');
  }
  const client = makeOAuthClient();
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

app.get('/api/health', (_, res) => {
  res.json({
    ok: true,
    message: 'UW Accounting server is running',
    timestamp: new Date().toISOString(),
    googleConfigured: Boolean(getGoogleConfig().clientId && getGoogleConfig().clientSecret),
    driveConnected: driveState.connected,
  });
});

app.get('/api/google-drive/config', (_, res) => {
  const config = getGoogleConfig();
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

app.get('/api/google-drive/auth', (_, res) => {
  const config = getGoogleConfig();
  if (!config.clientId || !config.clientSecret) {
    return res.status(503).json({ error: 'Google OAuth is not configured on the backend.' });
  }
  cleanStateStore();
  const state = crypto.randomBytes(16).toString('hex');
  stateStore.set(state, { createdAt: Date.now() });
  const oauth2Client = makeOAuthClient();
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
    const oauth2Client = makeOAuthClient();
    const { tokens } = await oauth2Client.getToken(String(code));
    driveState.tokens = tokens;
    driveState.connected = true;
    driveState.lastSync = new Date().toISOString();

    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const response = await drive.about.get({ fields: 'user' });
    driveState.accountEmail = response.data.user?.emailAddress || '';

    return res.send(`<!doctype html>
      <html><head><meta charset="utf-8" /></head>
      <body style="font-family:sans-serif;background:#0b1220;color:#f8fafc;padding:30px;display:grid;place-items:center;min-height:100vh;">
        <div style="max-width:520px;background:#111827;border:1px solid #374151;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,0.25);text-align:center;">
          <h2 style="margin-top:0;">Google Drive connected</h2>
          <p>${driveState.accountEmail || 'Your account is now linked.'}</p>
          <p style="color:#cbd5e1;">This window will close and return you to the application.</p>
          <script>
            setTimeout(() => {
              if (window.opener) {
                window.opener.postMessage({ type: 'google-drive-auth-success', email: ${JSON.stringify(driveState.accountEmail || '')} }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            }, 1200);
          </script>
        </div>
      </body></html>
    `);
  } catch (error) {
    console.error('Google OAuth callback failed:', error);
    return res.status(500).send(`<html><body><h2>Google Drive setup failed</h2><p>${String(error.message || error)}</p><p><a href="/">Return to app</a></p></body></html>`);
  }
});

app.post('/api/google-drive/disconnect', (_, res) => {
  driveState.tokens = null;
  driveState.connected = false;
  driveState.accountEmail = '';
  driveState.fileId = '';
  driveState.lastSync = null;
  return res.json({ ok: true, message: 'Google Drive disconnected.' });
});

app.get('/api/google-drive/status', (_, res) => {
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

app.post('/api/google-drive/sync', async (req, res) => {
  try {
    const config = getGoogleConfig();
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
  const drive = getDriveClient();

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

app.post('/api/google-drive/restore', async (req, res) => {
  try {
    const config = getGoogleConfig();
    if (!config.clientId || !config.clientSecret) {
      return res.status(503).json({ error: 'Google OAuth is not configured on the backend.' });
    }
    if (!driveState.tokens) {
      return res.status(401).json({ error: 'Google Drive is not connected.' });
    }

    const fileName = String(req.body?.fileName || driveState.fileName || 'UW_ACCOUNTING_BACKUP.json');
    const folderId = String(req.body?.folderId || driveState.folderId || '');
    const backupFolderName = String(req.body?.backupFolderName || driveState.backupFolderName || 'UW Accounting Backups');
    const drive = getDriveClient();
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

app.get('/__source/*', (req, res) => {
  const relativePath = decodeURIComponent(req.params[0] || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const safePath = relativePath.split('/').filter(Boolean).filter(part => part !== '..' && part !== '.').join('/');
  const candidate = path.join(rootDir, '__source', safePath);

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

app.use(express.static(rootDir, { index: 'index.html' }));

app.get('*', (_, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`UW Accounting app and API running at http://${HOST}:${PORT}`);
  console.log('Google OAuth backend status:', getGoogleConfig().clientId && getGoogleConfig().clientSecret ? 'configured' : 'missing env vars');
});
