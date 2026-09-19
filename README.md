# UW Accounting System

This is a locally runnable, installable Progressive Web App. It works offline and keeps a browser cache for fallback, while the Node server provides the authoritative versioned JSON datastore and managed document storage.

The imported operational modules include jobs and production stages, suppliers and stock-source catalogues, purchase/payable document review, a document register, and an AI business assistant. The assistant can provide local operational context, while the optional Gemini integration can review an individual receipt or invoice image/PDF and return structured fields for confirmation.

Payroll is populated from the supplied `WAGES.xlsx` sheet. The app preserves the sheet's staff names and daily rates and displays weekly, monthly, and annual wage figures. Use the sun/moon button in the top bar or **Settings → Appearance** to switch between light and dark mode; the choice is saved locally.

Invoice and quotation previews use the supplied `Invoice Template.docx` and `Quote Template.xlsx` branding, field structure, terms, banking details, signature areas, and exact UW logo artwork. The original templates and extracted logo assets are bundled in the package for reference.

The local launcher exposes the complete `D:\UW` tree through the Document Register. It indexes the full filesystem manifest, while preserving structured accounting records separately; PDFs and image files can be viewed in-app, and Office documents can be opened or downloaded from the register. When the app is downloaded to another machine, place the source files in a `documents` or `newstatements` folder beside the app, place the supplied `UW` and scanned folders beside the repository, or set `UW_SOURCE_DIR` to the real source folder before starting `server.js`. The viewer resolves historical absolute paths, filename-only records, duplicate backup copies, and compatible alternate extensions such as a `.docx` record backed by an available `.pdf`. Always start the local server (do not open `index.html` directly) so the source-file route is available. The supplied source library is intentionally not committed to Git because it is approximately 3.1 GB; preserve the three source folders as a separate backup/archive and use managed uploads plus Supabase Storage for production documents. Existing invoices and quotes include Edit actions. A quote converted to an invoice keeps a source link and can be undone while no payment or receipt has been recorded; this returns the quote to Draft without deleting financial history from paid invoices. Jobs can be linked to invoices, and linked totals/balances are read live from the invoice ledger. Backup/copy and lock artifacts remain visible for audit but are flagged and are not included in primary imported totals.

The register highlights unreviewed source files in red. Reviewers can open the source and choose **Approve**; the approval and `includedInTotals` decision are stored locally with a timestamp. Source files are never automatically added to financial totals merely because they exist or are approved: a reviewed amount must be entered or linked to a structured invoice/expense/payable record to prevent duplicate counting.

The **Scanned Receipts & Invoices** page contains the 366 files from `D:\UW\UW INVOICES-RECEIPTS&EXPENSES` and `D:\UW\UW INVOICES-RECEIPTS& EXPENSES 2 B`. The import found 299 unique SHA-256 file hashes and 67 exact duplicate copies. Duplicate copies remain visible and flagged for audit but are excluded from totals. Scanned images and PDFs can be viewed locally; because image-only scans do not provide reliable structured amounts without OCR verification, they remain `Needs review` until a user verifies and links the amount.

The scanned page supports filename/date/category filtering and local uploads for future JPG, PNG, and PDF scans. Uploaded files are stored in the browser database and can be reviewed with the same viewer controls. The Dashboard reports the number awaiting review, but does not invent invoice or expense amounts from image pixels. Quote creation includes price-book presets for the established item names, sizes, types, and materials; selecting a preset fills the code, description, and calculated starting price.

The **FNB Reconciliation** page now uses the 12 attached `GOLD_BUSINESS_ACCOUNT_1-12.docx` statements (44 pages total) for the FNB Gold Business Account ending `9557`. It imports and reconciles 1,563 statement transactions, ZAR 1,043,240.67 in credits, ZAR 1,037,709.38 in debits, and the 31 August 2026 closing balance of ZAR 5,531.29. Statement turnover is deliberately kept separate from invoices, expenses, receipts, payables/purchases, and reports until each transaction is allocated, preventing duplicate counting. The page provides monthly balances, statement-level credit/debit totals, source-period provenance, and an allocation queue.

All document-facing pages (invoices, quotes, receipts, expenses, payables, the full document register, scanned documents, and the media gallery) provide consistent search, category, status, and date filtering where applicable. Filters update the displayed rows immediately and show the matching count.

Supabase-backed cloud persistence is available through the application server. Use **Save to Cloud** for an encrypted-in-transit state sync and **Restore from Cloud** to pull the selected workspace back into local storage after device loss or replacement. The browser does not connect with a service-role key; the server performs the privileged Supabase operation.

Google Drive backup is now implemented through a secure backend-first OAuth flow. Configure a Google Web OAuth client in Google Cloud Console and add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` to your environment before using **Sign in with Google Drive**. The app keeps the browser app offline-first, but the durable Google Drive connection is managed through the backend so the system is ready for safe deployment. The app still supports a local advanced token fallback until the backend credentials are configured.

Optional AI assistance is backend-only. Set either `GEMINI_API_KEY` / `GEMINI_MODEL` or `TYPESAFE_API_KEY` / `TYPESAFE_MODEL` in the local `.env` or deployment secret settings, and use `AI_PROVIDER=typesafe` or `AI_PROVIDER=gemini` to choose the active backend provider. The **AI Business Assistant -> Ask AI** action sends only the prompt entered by the user; the API key is never sent to the browser or committed to the repository. On **Scanned Receipts & Invoices**, **AI review** sends one supported image/PDF to Gemini and extracts the visible document date, merchant/store, amount paid, currency, document type, invoice number, confidence, and notes. The result is shown for explicit confirmation before it changes any accounting metadata; unreadable or missing values remain blank rather than being guessed. Gemini receives the document bytes, so configure an approved retention/privacy policy before enabling it in production. Review requests are rate-limited and documents are never written to logs. Revoke any key that has been pasted into chat, source control, logs, or other exposed locations and replace it with a newly generated secret.

## Run locally on Windows

1. Install the app dependencies with `npm install`.
2. Copy `.env.example` to `.env` and add your Google Web OAuth credentials.
3. Start the app with `npm start`.
4. Open `http://localhost:8080`.
5. Use the browser menu's **Install app** option, or use **Install App** in the top bar when available.

Do not open `index.html` directly with `file://` when you need installability or cloud sync. Browsers require a local HTTP server for service workers and PWA features.

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

The browser login remains a client-side convenience; production deployments must put the server behind an authenticated network or configure `UW_API_KEY` (or an upstream identity-aware proxy). The backend smoke test and readiness endpoint provide deployment diagnostics; they do not replace organizational access controls or tested restore procedures.

## Data, persistence, and managed documents

The server stores `uw-state.json` under `UW_DATA_DIR` (or `UW_DB_FILE`) and creates a `.bak` before every atomic replacement. Each snapshot has `version`, `revision`, `updatedAt`, and `data`; state writes use optimistic revision checks and return `409` on conflicts. `GET/PUT /api/state`, `/api/state/backup`, and `/api/state/restore` support application sync and safe operator backups. Set `UW_API_KEY` for any shared or production deployment; requests use `x-api-key` or a Bearer token.

Uploaded files are kept outside the JSON in `UW_DOCUMENTS_DIR` and replicated to the private `SUPABASE_DOCUMENT_BUCKET` when Supabase is configured. They are accessed through `/api/documents`, `/api/documents/:id`; if the local file is unavailable after an instance replacement, the server retrieves the private Supabase Storage copy. Uploads are size/type checked and use random IDs, so filenames cannot escape the managed directory. The UI uses these URLs when the server is available and falls back to browser data URLs offline.

Historical records may contain old Windows paths such as `D:\UW\...`; those paths are treated as lookup metadata only and are never sent to the browser as a file URL. The viewer calls `/api/source-file`, which first searches configured local source roots and then searches the private Supabase document registry by filename (including a compatible filename-stem match). To make an archive viewable in a deployed service, upload its files from **Document Register** or **Scanned Receipts & Invoices** so they are stored in `UW_DOCUMENTS_DIR` and replicated to Supabase Storage. A deployed Render instance cannot access a workstation's `D:\UW` drive, and the original archive must not be committed to Git.

The deployed resolver also indexes the existing `uw-documents/UW/`, `UW INVOICES-RECEIPTS & EXPENSES/`, `UW INVOICES-RECIEPTS & EXPENSES/`, and corresponding `... 2 B` folders directly from Supabase Storage. This supports files that were placed in the bucket before an application metadata row was created. New managed uploads are saved under `uw-documents/UW/<generated-id>-<filename>` and recorded in `uw_documents`, so future viewing uses the same durable bucket namespace.

At startup, the browser requests `/api/documents/catalog`; the server recursively inventories the private bucket from its root and associates matching filenames with the imported document register and scanned records. Historical paths such as `D:\UW\2025\CLIENT RECEIPTS\MARCH25\RC10032509.pdf` are converted into the Storage candidate `UW/2025/CLIENT RECEIPTS/MARCH25/RC10032509.pdf`, with filename fallback afterward. This keeps the local register and deployed viewer on the same Supabase-backed source of truth. If the catalog is empty in production, verify that `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_DOCUMENT_BUCKET=uw-documents` are set on Render and that the service-role can list/read the private bucket.

The browser retains a local cache for offline use. Use **Export Backup** regularly and keep the JSON file somewhere safe; **Restore Backup** imports the complete database. Server backups should be made from `/api/state/backup` or the configured data directory.

The **Income & Receipts** page is the payment register. Issued receipts use `BBYYYY/MM/DD01` or `SSYYYY/MM/DD01` numbering and increment independently by prefix/date. Paid invoices are highlighted green, while outstanding invoices remain visible with their current balance. Each receipt can be opened and printed as a customer-facing proof of payment.

## Supabase durable sync and documents

Run `supabase/migrations/001_uw_accounting.sql` and then `supabase/migrations/002_document_id_text.sql` in the Supabase SQL Editor before enabling production sync. The second migration is required if the first migration was already run: it converts document metadata IDs from UUID to the app's safe 32-character document IDs. Together they create the versioned `uw_accounting_data` table, document metadata table, private `uw-documents` bucket, and restrictive RLS policies. The migration intentionally grants no direct table or bucket access to `anon` or `authenticated`; the server uses the service-role secret after the application request has passed its server authorization layer.

Configure the deployment with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_WORKSPACE`, and `SUPABASE_STATE_TABLE`. The service-role secret must exist only in Render/server environment secrets and must never be placed in `index.html`, browser localStorage, or the public repository. Server state writes remain local-first and are asynchronously replicated to Supabase; startup selects the newer valid snapshot by timestamp/revision. The browser continues to use localStorage as an offline cache and calls the application API for cloud save/restore.

The supplied publishable/anon key is not required for the server-controlled sync path. Do not use the service-role secret or API secret in browser code. Rotate any credential that has been exposed outside the Supabase/Render secret stores.
