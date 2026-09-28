# UW Accounting System

This is a locally runnable, installable Progressive Web App. It works offline and keeps a browser cache for fallback, while the Node server provides the authoritative versioned JSON datastore and managed document storage.

The imported operational modules include jobs and production stages, suppliers and stock-source catalogues, purchase/payable document review, a document register, and an AI business assistant. The assistant can provide local operational context, while the optional Gemini integration can review an individual receipt or invoice image/PDF and return structured fields for confirmation.

Payroll is populated from the supplied `WAGES.xlsx` sheet. The app preserves the sheet's staff names and daily rates and displays weekly, monthly, and annual wage figures. Use the sun/moon button in the top bar or **Settings → Appearance** to switch between light and dark mode; the choice is saved locally.

Invoice and quotation previews use the supplied `Invoice Template.docx` and `Quote Template.xlsx` branding, field structure, terms, banking details, signature areas, and exact UW logo artwork. The original templates and extracted logo assets are bundled in the package for reference.

The local launcher exposes the complete `D:\UW` tree through the Document Register. It indexes the full filesystem manifest, while preserving structured accounting records separately; PDFs and image files can be viewed in-app, and Office documents can be opened or downloaded from the register. When the app is downloaded to another machine, place the source files in a `documents` or `newstatements` folder beside the app, place the supplied `UW` and scanned folders beside the repository, or set `UW_SOURCE_DIR` to the real source folder before starting `server.js`. The viewer resolves historical absolute paths, filename-only records, duplicate backup copies, and compatible alternate extensions such as a `.docx` record backed by an available `.pdf`. Always start the local server (do not open `index.html` directly) so the source-file route is available. The supplied source library is intentionally not committed to Git because it is approximately 3.1 GB; preserve the three source folders as a separate backup/archive and use managed uploads plus Supabase Storage for production documents. Existing invoices and quotes include Edit actions. A quote converted to an invoice keeps a source link and can be undone while no payment or receipt has been recorded; this returns the quote to Draft without deleting financial history from paid invoices. Jobs can be linked to invoices, and linked totals/balances are read live from the invoice ledger. Backup/copy and lock artifacts remain visible for audit but are flagged and are not included in primary imported totals.

The register highlights unreviewed source files in red. Reviewers can open the source and choose **Approve**; the approval and `includedInTotals` decision are stored locally with a timestamp. Source files are never automatically added to financial totals merely because they exist or are approved: a reviewed amount must be entered or linked to a structured invoice/expense/payable record to prevent duplicate counting.

The **Scanned Receipts & Invoices** page contains the 366 files from `D:\UW\UW INVOICES-RECEIPTS&EXPENSES` and `D:\UW\UW INVOICES-RECEIPTS& EXPENSES 2 B`. The import found 299 unique SHA-256 file hashes and 67 exact duplicate copies. Duplicate copies remain visible and flagged for audit but are excluded from totals. Scanned images and PDFs can be viewed locally; because image-only scans do not provide reliable structured amounts without OCR verification, they remain `Needs review` until a user verifies and links the amount.

The scanned page supports filename/date/category filtering and local uploads for future JPG, PNG, and PDF scans. Uploaded files are stored in the browser database and can be reviewed with the same viewer controls. The Dashboard reports the number awaiting review, but does not invent invoice or expense amounts from image pixels. Quote creation includes price-book presets for the established item names, sizes, types, and materials; selecting a preset fills the code, description, and calculated starting price.

The **FNB Reconciliation** page now uses the 12 attached `GOLD_BUSINESS_ACCOUNT_1-12.docx` statements (44 pages total) for the FNB Gold Business Account ending `9557`. It imports and reconciles 1,563 statement transactions, ZAR 1,043,240.67 in credits, ZAR 1,037,709.38 in debits, and the 31 August 2026 closing balance of ZAR 5,531.29. On **Scanned Receipts & Invoices**, **Review FNB** compares a receipt's reviewed date and amount to imported statement debits within a three-day posting window and ZAR 0.02 amount tolerance; when a merchant is present, it must also match. Credits are excluded, and a transaction already linked to another scan or multiple equally plausible bank rows is flagged rather than auto-confirmed. Run Gemini review first if a scan has no readable date or amount. The first batch action changes to **Review FNB matches again** afterward; each run rechecks all eligible scans, including new ones. New uploads receive an FNB comparison immediately, and the result refreshes after Gemini fills in receipt details. Statement turnover remains separate from invoices, expenses, receipts, payables/purchases, and reports until each transaction is allocated, preventing duplicate counting. The page provides monthly balances, statement-level credit/debit totals, source-period provenance, and an allocation queue.

All document-facing pages (invoices, quotes, receipts, expenses, payables, the full document register, scanned documents, and the media gallery) provide consistent search, category, status, and date filtering where applicable. Filters update the displayed rows immediately and show the matching count.

Supabase-backed cloud persistence is available through the application server. Use **Save to Cloud** for an encrypted-in-transit state sync and **Restore from Cloud** to pull the selected workspace back into local storage after device loss or replacement. The browser does not connect with a service-role key; the server performs the privileged Supabase operation.

Google Drive backup is now implemented through a secure backend-first OAuth flow. Configure a Google Web OAuth client in Google Cloud Console and add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` to your environment before using **Sign in with Google Drive**. The app keeps the browser app offline-first, but the durable Google Drive connection is managed through the backend so the system is ready for safe deployment. The app still supports a local advanced token fallback until the backend credentials are configured.

Optional AI assistance is backend-only and uses **Gemini exclusively**. Set `GEMINI_API_KEY` and `GEMINI_MODEL` in the local `.env` or deployment secret settings. The **AI Business Assistant -> Ask AI** action sends only the prompt entered by the user; the API key is never sent to the browser or committed to the repository. The assistant is constrained to UW Accounting System context and refuses unrelated requests. Chat and receipt-review calls automatically try other available Gemini Flash models when a model returns a quota/rate-limit, temporary service, or model-unavailable error, and temporarily cool down that model using the provider's retry timing when available. Invalid keys, permission/billing errors, and invalid requests are returned without model switching. Failover cannot overcome project-wide quota exhaustion or billing/credential problems; in that case, the request still fails clearly. On **Scanned Receipts & Invoices**, **AI review** sends one supported image/PDF to Gemini and extracts the visible document date, merchant/store, amount paid, currency, document type, invoice number, confidence, and notes. The result is shown for explicit confirmation before it changes any accounting metadata; unreadable or missing values remain blank rather than being guessed. Gemini receives the document bytes, so configure an approved retention/privacy policy before enabling it in production. Review requests are rate-limited and documents are never written to logs. Revoke any credential pasted into chat, source control, logs, or other exposed locations and replace it with a newly generated secret.

## Run locally on Windows

1. Install the app dependencies with `npm install`.
2. Copy `.env.example` to `.env` and add your Google Web OAuth credentials.
3. Start the app with `npm start`.
4. Open `http://localhost:8080`.
5. Use the browser menu's **Install app** option, or use **Install App** in the top bar when available.

Do not open `index.html` directly with `file://` when you need installability or cloud sync. Browsers require a local HTTP server for service workers and PWA features.

### Keep the server running on this Windows PC

To run the app in the background whenever you sign in to Windows, open PowerShell in the project folder and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\install-local-autostart.ps1
```

This installs a separate copy under `%LOCALAPPDATA%\UWAccountingSystem`, preserves the current `data` folder, installs its Node dependencies, and registers and starts a per-user Task Scheduler task. The server binds only to `127.0.0.1:8080`, restarts after an unexpected exit, and writes rotating UTF-8 logs to `data\logs\server.log`. The task also starts automatically at future sign-ins.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\UWAccountingSystem\scripts\local-server-task.ps1" Start
```

Open `http://localhost:8080`. Use the same `local-server-task.ps1` with `Status` or `Stop`; `Uninstall` removes only the startup task and leaves application files/data in place. To update the installed app from a newer checkout, run `install-local-autostart.ps1 -Update`; it stops and restarts the task, replacing code and dependencies without replacing the installed `data` folder. The app is available only while this PC is on and awake; this setup does not alter power/sleep settings or expose the app to other devices.

The **UW Accounting System** desktop shortcut starts the scheduled server if the local app is not responding, waits for it to become healthy, and opens it in your browser. Use it after closing the browser or if the server was stopped.

The app stores its accounting state and managed documents under `%LOCALAPPDATA%\UWAccountingSystem\data`; state is atomically written to disk and mirrored to Supabase when available. Browser changes made while another state sync is in flight are queued and sent immediately afterward, rather than being dropped. On sign-in, the installer creates a backup immediately and registers a daily 1:00 PM backup task to `D:\UW FOREVER\Local Backups`, retaining 30 timestamped copies of the local state, state `.bak`, managed documents, and saved invoice/quote PDFs. Runtime logs, upload temp files, and `.env` secrets are excluded. Invoice and quote PDFs are separately written under `D:\UW FOREVER\Saved Invoices` and `D:\UW FOREVER\Saved Quotes` whenever records are created or changed and whenever PDFs are exported. These folders are independent of the app installation, so code updates and server restarts do not replace them. The app runs as the current Windows user and the installer verifies that account can read, write, update, and delete files under `D:\UW FOREVER`. Continue to keep an additional backup on a separate physical device or trusted cloud storage for protection against drive failure.

The local server searches both `D:\UW` and `D:\UW FOREVER` when resolving reference files. The installed server process has full access to the latter using the current Windows account; place reference material anywhere below that folder. Keep the app open only on a trusted Windows user account; local mode does not require operator sign-in.

#### Configure the existing local login, Supabase, and Google Drive

The local install deliberately does not copy deployment secrets. To enable Brian and Evans' existing passphrases and the same cloud services, open PowerShell and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\UWAccountingSystem\scripts\configure-local-integrations.ps1"
```

Enter each existing passphrase twice in the hidden prompts. Then provide the Supabase service-role key, Google OAuth client secret, and the existing `UW_TOKEN_ENCRYPTION_KEY` from the prior deployment settings. The Supabase project URL defaults to this system's configured project; the wizard checks the state, session, secret, and document tables plus the private storage bucket before it writes configuration. The local `.env` is ACL-restricted to this Windows user, SYSTEM, and Administrators; secrets are not printed or sent through chat. The wizard restarts the local service and tests both sign-ins, Supabase status, and the Google OAuth redirect. It preserves other local settings such as the Gemini key.

Use the same Supabase workspace (`default` for the existing configuration) and especially the same encryption key to recover saved Google Drive credentials. If the previous key is unavailable, the wizard requires confirmation that Drive must be reauthorized. Run the existing SQL migrations if the table or bucket checks report they are missing. In Google Cloud Console, register `http://localhost:8080` as an authorized JavaScript origin and `http://localhost:8080/api/google-drive/callback` as an authorized redirect URI. After setup, choose **Sign in with Google Drive** in the app if no saved Drive authorization was restored. The local server restores an existing Supabase snapshot into a new empty local data folder before it can synchronize local state, preventing an empty first-run datastore from replacing the cloud backup.

#### Configure Gemini AI on the local server

If AI reviews report that Gemini is not configured, revoke any Gemini key previously pasted into chat or otherwise exposed, create a replacement key, and set it locally without pasting it into chat:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\UWAccountingSystem\scripts\configure-local-gemini.ps1"
```

Enter the replacement key at the hidden prompt. The script stores it only in the ACL-restricted local `.env`, restarts the local server, and confirms the server recognizes Gemini without printing or sending the key. AI requests are sent from the server directly to Google Gemini; document-review requests include the selected document bytes.

## Deploying on Vercel

Vercel detects the Express app exported from `server.js`; browser assets live in `public/` so Vercel can serve them from its CDN. The Vercel runtime uses `/tmp` for temporary files and does not start a persistent HTTP listener. Vercel storage is ephemeral, so configure Supabase before using production data: set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_WORKSPACE`, `SUPABASE_STATE_TABLE`, and `SUPABASE_DOCUMENT_BUCKET`, and run all listed Supabase migrations. Also configure `UW_API_KEY`, `UW_AUTH_USERS_JSON`, `UW_TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` for production authentication and OAuth. `/api/ready` reports not-ready until required production settings are present.

Set the Google OAuth redirect URI to `https://<your-vercel-domain>/api/google-drive/callback` and add that URL and the Vercel origin to the Google OAuth client. Vercel serverless instances do not share in-memory session state or local files; durable application state, user sessions, and uploaded documents must use the configured Supabase services. Use the Render instructions below if a persistent-disk deployment is preferred.

## Production deployment checklist

- Run `npm test` before every deployment. This starts a disposable server and verifies health, security headers, readiness reporting, AI validation, and Drive status responses.
- Check `GET /api/ready` after deployment. A `503` response means the deployment is not ready for production traffic. In production it intentionally remains blocked until server authentication, durable persistence, and source-document storage are implemented and enabled.
- Create a Google Cloud **Web OAuth client** for the deployed domain.
- Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` to your deployment environment.
- Ensure the OAuth redirect URI matches the deployed backend route exactly, without duplicate slashes.
- Use `https://uwwarehouse-2.onrender.com/api/google-drive/callback` as the production URL for this specific deployment.
- If Render reports `EACCES: permission denied, mkdir '/var/lib/uw-accounting'`, remove or replace the old `UW_DATA_DIR` and `UW_DOCUMENTS_DIR` values. Render persistent disks should use a mount path such as `/var/data`; set `UW_DATA_DIR=/var/data/uw-accounting` and `UW_DOCUMENTS_DIR=/var/data/uw-accounting/documents`, attach the disk at `/var/data`, then redeploy. The server now falls back to its writable application `data` directory instead of crashing when an invalid path is configured, but that fallback is ephemeral and must not be used as the durable production store.

### OAuth redirect mismatch troubleshooting

Google validates OAuth URLs against the Google Cloud OAuth client, not against this repository. For the official web client
`543852392281-hgn4dojctifs8lh31lldullqd7bsfmd5.apps.googleusercontent.com`, configure both of these **Authorized JavaScript origins**:

- `http://localhost:8080`
- `https://uwwarehouse-2.onrender.com`

Configure these exact **Authorized redirect URIs** for the secure backend flow:

- `http://localhost:8080/api/google-drive/callback`
- `https://uwwarehouse-2.onrender.com/api/google-drive/callback`

Do not add a trailing slash, a doubled slash, or `/index.html`. The local backend also requires a `.env` file based on
`.env.example`, including the Google client secret. If the client secret is absent, the browser fallback is used and Google
will reject the request unless the current origin is registered as an Authorized JavaScript origin.
- Keep the app offline-first for local use, but run Google Drive sync through the backend in production.
- Store secrets only in environment variables or a secure secret manager; never embed them in the browser bundle.

### Current release blockers

Production authentication uses server-only operator accounts configured with `UW_AUTH_USERS_JSON`. The supported profiles are **Brian** and **Evans**; the dropdown uses each account key or display name, then the selected profile is verified with its password. Each account stores only an scrypt password hash. To preserve the existing passphrases without placing them in source control, generate the complete JSON locally with `node scripts/generate-auth-config.js "Brian's existing passphrase" "Evans's existing passphrase"` and copy the output into the Render `UW_AUTH_USERS_JSON` secret. The browser never contains operator passwords. A real phone OTP can be added later through an SMS provider; it is not simulated locally. `UW_API_KEY` remains available for trusted automation and deployment probes, but Origin/Referer headers are never treated as credentials.

State conflicts are preserved instead of silently overwritten. When the server reports a newer revision, the local draft is saved to `UW_STATE_CONFLICT` and Settings offers **Use server copy**, **Keep local copy**, or **Export local backup**. State writes validate core collection shapes and reject oversized/malformed envelopes.

## Data, persistence, and managed documents

The server stores `uw-state.json` under `UW_DATA_DIR` (or `UW_DB_FILE`) and creates a `.bak` before every atomic replacement. Each snapshot has `version`, `revision`, `updatedAt`, and `data`; state writes use optimistic revision checks and return `409` on conflicts. `GET/PUT /api/state`, `/api/state/backup`, and `/api/state/restore` support application sync and safe operator backups. Set `UW_API_KEY` for any shared or production deployment; requests use `x-api-key` or a Bearer token.

Uploaded files are kept outside the JSON in `UW_DOCUMENTS_DIR` and replicated to the private `SUPABASE_DOCUMENT_BUCKET` when Supabase is configured. They are accessed through `/api/documents`, `/api/documents/:id`; if the local file is unavailable after an instance replacement, the server retrieves the private Supabase Storage copy. Uploads are size/type checked and use random IDs, so filenames cannot escape the managed directory. The UI uses these URLs when the server is available and falls back to browser data URLs offline.

Historical records may contain old Windows paths such as `D:\UW\...`; those paths are treated as lookup metadata only and are never sent to the browser as a file URL. The viewer calls `/api/source-file`, which first searches configured local source roots and then searches the private Supabase document registry by filename (including a compatible filename-stem match). To make an archive viewable in a deployed service, upload its files from **Document Register** or **Scanned Receipts & Invoices** so they are stored in `UW_DOCUMENTS_DIR` and replicated to Supabase Storage. A deployed Render instance cannot access a workstation's `D:\UW` drive, and the original archive must not be committed to Git.

The deployed resolver also indexes the existing `uw-documents/UW/`, `UW INVOICES-RECEIPTS & EXPENSES/`, `UW INVOICES-RECIEPTS & EXPENSES/`, and corresponding `... 2 B` folders directly from Supabase Storage. This supports files that were placed in the bucket before an application metadata row was created. New managed uploads are saved under `uw-documents/UW/<generated-id>-<filename>` and recorded in `uw_documents`, so future viewing uses the same durable bucket namespace.

At startup, the browser requests `/api/documents/catalog`; the server recursively inventories the private bucket from its root and associates matching filenames with the imported document register and scanned records. Historical paths such as `D:\UW\2025\CLIENT RECEIPTS\MARCH25\RC10032509.pdf` are converted into the Storage candidate `UW/2025/CLIENT RECEIPTS/MARCH25/RC10032509.pdf`, with filename fallback afterward. This keeps the local register and deployed viewer on the same Supabase-backed source of truth. If the catalog is empty in production, verify that `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_DOCUMENT_BUCKET=uw-documents` are set on Render and that the service-role can list/read the private bucket.

The browser retains a local cache for offline use. Use **Export Backup** regularly and keep the JSON file somewhere safe; **Restore Backup** imports the complete database. Server backups should be made from `/api/state/backup` or the configured data directory.

The **Income & Receipts** page is the payment register. Issued receipts use `BBYYYY/MM/DD01` or `SSYYYY/MM/DD01` numbering and increment independently by prefix/date. Paid invoices are highlighted green, while outstanding invoices remain visible with their current balance. Each receipt can be opened and printed as a customer-facing proof of payment.

## Supabase durable sync and documents

Run `supabase/migrations/001_uw_accounting.sql`, `002_document_id_text.sql`, `003_document_workspace_indexes.sql`, and `004_auth_sessions_and_secrets.sql` in the Supabase SQL Editor before enabling production sync. Migration 004 creates the server-only durable session and encrypted-secret tables. The migration intentionally grants no direct table or bucket access to `anon` or `authenticated`; the server uses the service-role secret after the application request has passed its server authorization layer.

Configure the deployment with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_WORKSPACE`, and `SUPABASE_STATE_TABLE`. The service-role secret must exist only in server environment secrets and must never be placed in `index.html`, browser localStorage, or the public repository. State writes are saved locally first, then queued for Supabase replication. Failed cloud writes remain queued on the server and retry automatically with exponential backoff; `/api/supabase/status` reports whether the latest state is synced or pending. Global Save only reports a completed database save after the server confirms the Supabase upsert. Startup selects the newer valid snapshot by timestamp/revision, preserving local work when Supabase is temporarily unavailable.

For production authentication, also configure `UW_AUTH_USERS_JSON` and `UW_TOKEN_ENCRYPTION_KEY`. Generate the account JSON locally with `node scripts/generate-auth-config.js "LeatherGold2026" "WarehouseSunrise"` and paste the resulting one-line JSON into Render. Generate the encryption key with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and save it as a private Render secret. Never commit either value. Sessions and Google Drive refresh credentials are encrypted at rest in the Supabase tables using this key; changing the key intentionally invalidates existing durable sessions and stored Drive credentials, requiring reconnection.

The supplied publishable/anon key is not required for the server-controlled sync path. Do not use the service-role secret or API secret in browser code. Rotate any credential that has been exposed outside the Supabase/Render secret stores.
