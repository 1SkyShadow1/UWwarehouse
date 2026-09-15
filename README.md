# UW Accounting System

This is a locally runnable, installable Progressive Web App. It works offline and stores records in the browser's local database (`localStorage`). The optional Supabase integration can synchronize the database to a cloud workspace.

The imported operational modules include jobs and production stages, suppliers and stock-source catalogues, purchase/payable document review, a document register, and a local AI business assistant. The AI assistant is deliberately rule-based and explainable: it analyses locally stored totals, outstanding invoices, jobs, expense categories, and unreviewed supplier documents without sending business data to an external AI service.

Payroll is populated from the supplied `WAGES.xlsx` sheet. The app preserves the sheet's staff names and daily rates and displays weekly, monthly, and annual wage figures. Use the sun/moon button in the top bar or **Settings → Appearance** to switch between light and dark mode; the choice is saved locally.

Invoice and quotation previews use the supplied `Invoice Template.docx` and `Quote Template.xlsx` branding, field structure, terms, banking details, signature areas, and exact UW logo artwork. The original templates and extracted logo assets are bundled in the package for reference.

The local launcher exposes the complete `D:\UW` tree through the Document Register. It indexes the full filesystem manifest, while preserving structured accounting records separately; PDFs and image files can be viewed in-app, and Office documents can be opened or downloaded from the register. Existing invoices and quotes include Edit actions. A quote converted to an invoice keeps a source link and can be undone while no payment or receipt has been recorded; this returns the quote to Draft without deleting financial history from paid invoices. Jobs can be linked to invoices, and linked totals/balances are read live from the invoice ledger. Backup/copy and lock artifacts remain visible for audit but are flagged and are not included in primary imported totals.

The register highlights unreviewed source files in red. Reviewers can open the source and choose **Approve**; the approval and `includedInTotals` decision are stored locally with a timestamp. Source files are never automatically added to financial totals merely because they exist or are approved: a reviewed amount must be entered or linked to a structured invoice/expense/payable record to prevent duplicate counting.

The **Scanned Receipts & Invoices** page contains the 366 files from `D:\UW\UW INVOICES-RECEIPTS&EXPENSES` and `D:\UW\UW INVOICES-RECEIPTS& EXPENSES 2 B`. The import found 299 unique SHA-256 file hashes and 67 exact duplicate copies. Duplicate copies remain visible and flagged for audit but are excluded from totals. Scanned images and PDFs can be viewed locally; because image-only scans do not provide reliable structured amounts without OCR verification, they remain `Needs review` until a user verifies and links the amount.

The scanned page supports filename/date/category filtering and local uploads for future JPG, PNG, and PDF scans. Uploaded files are stored in the browser database and can be reviewed with the same viewer controls. The Dashboard reports the number awaiting review, but does not invent invoice or expense amounts from image pixels. Quote creation includes price-book presets for the established item names, sizes, types, and materials; selecting a preset fills the code, description, and calculated starting price.

The **FNB Reconciliation** page inventories all 12 PDFs in `D:\UW\2025\UW\FNB Bank\2025-2026` (44 pages total). Local PDF structure inspection confirmed that all 12 are image-only scans with no usable text layer; the environment has no OCR-capable PDF extraction tool. Consequently, 0 transaction rows and 0 statement totals were imported, no accounting totals were changed, and all 12 statements remain **Needs review**. The page preserves each exact source path and page count, supports statement/status/category filters, matched/unmatched counters, and a review queue. Transactions may only be added after reliable OCR or manual verification against invoices, expenses, receipts, payables and existing bank data. Quote creation includes price-book presets for the established item names, sizes, types, and materials; selecting a preset fills the code, description, and calculated starting price.

All document-facing pages (invoices, quotes, receipts, expenses, payables, the full document register, scanned documents, and the media gallery) provide consistent search, category, status, and date filtering where applicable. Filters update the displayed rows immediately and show the matching count.

Optional Supabase cloud backup is available under Settings. Use **Save to Cloud** for an encrypted-in-transit JSON backup and **Restore from Cloud** to pull the selected workspace back into local storage after device loss or replacement. Configure Row Level Security and use a publishable/anonymous key only; never place a service-role key in the browser.

Google Drive backup is also available under Settings. Enter a Google OAuth access token, test the connection, optionally choose a Drive folder, and enable **Keep backup continuously updated**. The connection preference, folder, backup filename, and Drive file ID are retained locally until **Disconnect** is selected. Automatic saves update the same Drive JSON file instead of creating duplicate files. Google access tokens can still expire or be revoked by Google, in which case reconnect with a fresh token.

## Run locally on Windows

1. Double-click `start-local.ps1`, or run `.\start-local.ps1` in PowerShell. The launcher uses Python when available and otherwise includes a Windows PowerShell web-server fallback.
3. Open `http://localhost:8080`.
4. Use the browser menu's **Install app** option, or use **Install App** in the top bar when available.

Do not open `index.html` directly with `file://` when you need installability or cloud sync. Browsers require a local HTTP server for service workers and PWA features.

## Data and backups

Local data is retained in the browser profile on that computer. Use **Export Backup** regularly and keep the JSON file somewhere safe. **Restore Backup** imports the complete database.

## Optional Supabase cloud sync

Create this table in Supabase:

```sql
create table uw_accounting_data (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null
);
```

Configure the project URL and publishable/anon key in **Settings → Optional Cloud Sync**. Configure Row Level Security policies for the users who should read and write the selected workspace. The browser only receives the publishable key; never put a Supabase service-role key in this app.
