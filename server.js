require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');

const app = express();
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const rootDir = __dirname;
const stateStore = new Map();
const driveState = {
  tokens: null,
  connected: false,
  accountEmail: '',
  fileId: '',
  fileName: 'UW_ACCOUNTING_BACKUP.json',
  folderId: '',
  lastSync: null,
};

const normalizeGoogleRedirectUri = (value = '') => {
  const cleaned = String(value).trim();
  if (!cleaned) return cleaned;
  return cleaned.replace(/([^:])\/{2,}/g, '$1/');
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
    redirectUri: config.redirectUri,
    state: { connected: driveState.connected, accountEmail: driveState.accountEmail, fileName: driveState.fileName, folderId: driveState.folderId, fileId: driveState.fileId, lastSync: driveState.lastSync },
  });
});

app.get('/api/google-drive/auth', (_, res) => {
  const config = getGoogleConfig();
  if (!config.clientId || !config.clientSecret) {
    return res.status(503).json({ error: 'Google OAuth is not configured on the backend.' });
  }
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
    if (!code || !state || !stateStore.has(String(state))) {
      return res.status(400).send('<html><body><h2>Invalid Google OAuth state.</h2><p>Please retry the connection.</p><p><a href="/">Return to app</a></p></body></html>');
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
    const drive = getDriveClient();

    let fileId = req.body?.fileId || driveState.fileId || '';
    if (!fileId) {
      const q = getDriveFileQuery(fileName, folderId);
      const listResponse = await drive.files.list({ q, pageSize: 1, fields: 'files(id,name,modifiedTime)' });
      fileId = listResponse.data.files?.[0]?.id || '';
    }

    const metadata = {
      name: fileName,
      mimeType: 'application/json',
      ...(folderId ? { parents: [folderId] } : {}),
    };

    const uploadPayload = JSON.stringify(payload || {});
    const response = fileId
      ? await drive.files.update({
          fileId,
          requestBody: metadata,
          media: { mimeType: 'application/json', body: uploadPayload },
          fields: 'id,name,modifiedTime',
        })
      : await drive.files.create({
          requestBody: metadata,
          media: { mimeType: 'application/json', body: uploadPayload },
          fields: 'id,name,modifiedTime',
        });

    driveState.fileId = response.data.id || fileId;
    driveState.fileName = response.data.name || fileName;
    driveState.folderId = folderId;
    driveState.lastSync = new Date().toISOString();

    return res.json({
      ok: true,
      fileId: driveState.fileId,
      fileName: driveState.fileName,
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
    const drive = getDriveClient();
    const q = getDriveFileQuery(fileName, folderId);
    const listResponse = await drive.files.list({ q, pageSize: 1, fields: 'files(id,name,modifiedTime)' });
    const match = listResponse.data.files?.[0];
    if (!match) {
      return res.status(404).json({ error: 'No matching Google Drive backup was found.' });
    }

    const download = await drive.files.get({ fileId: match.id, alt: 'media' }, { responseType: 'arraybuffer' });
    const raw = Buffer.from(download.data).toString('utf8');
    const data = JSON.parse(raw);
    driveState.fileId = match.id;
    driveState.fileName = match.name || fileName;
    driveState.folderId = folderId;
    driveState.lastSync = new Date().toISOString();

    return res.json({ ok: true, data, fileId: match.id, fileName: match.name || fileName });
  } catch (error) {
    console.error('Google Drive restore failed:', error);
    return res.status(500).json({
      error: error.message || 'Google Drive restore failed.',
    });
  }
});

app.use(express.static(rootDir, { index: 'index.html' }));

app.get('*', (_, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`UW Accounting app and API running at http://${HOST}:${PORT}`);
  console.log('Google OAuth backend status:', getGoogleConfig().clientId && getGoogleConfig().clientSecret ? 'configured' : 'missing env vars');
});
