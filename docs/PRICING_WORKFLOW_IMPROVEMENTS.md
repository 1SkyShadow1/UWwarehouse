# Pricing and daily workflow improvements

Implemented recommendations 1, 4 and 8, the improved fabric picker, automated pricing checks and a focused split of the browser code.

## Pricing

- Invoice and quote lines distinguish recorded unit cost, selling price, markup percentage and pricing mode. Selecting a supplier fabric fills its dated listed cost using the chosen price/VAT/unit basis. New selections start at zero markup; the warning makes sales at or below cost visible. Operators choose the desired markup or manually enter a selling price.
- Markup and gross margin are different values: R102 cost plus 25% markup sells for R127.50, giving a 20% margin. Quantity 2.5 produces R255 cost, R318.75 selling and R63.75 estimated gross profit.
- Existing selling prices and overrides are retained. Historical lines without a recorded cost show an unknown margin; no cost is inferred from their selling price. Missing costs prevent a complete document margin being reported.
- Supplier VAT conversion remains explicit. These are estimates on each line's chosen basis, not an added tax calculation or a complete job profitability report.
- Calculator-created quotes apply markup to selling rates rather than exposing a separate margin line to customers. Calculations round selling rates to cents and aggregate quantities using the established document convention.
- Quote and invoice previews/PDFs omit the internal cost and markup fields.

## Quote validity and revisions

- New quotes default to an editable expiry 30 days after their date; changing the date refreshes that default. Existing expiry dates remain unchanged.
- Each changed save records a numbered revision, timestamp and independent snapshot. An unchanged save creates no extra revision. The Revisions action compares fields and lines and shows saved versions.
- Accept records an independent accepted snapshot. Editing an accepted quote creates a Draft revision, retaining accepted history and the original issued invoice. Conversion records the accepted revision on the invoice and deep-copies its lines.
- An expired draft cannot be accepted or converted until its validity is extended. Acceptance also requires a customer, date and valid selling lines. Previously accepted quotes can still be invoiced after expiry.
- Legacy revision history starts with the version that exists when it is first edited; earlier historical edits cannot be reconstructed.
- Quote previews and server-generated PDFs show the actual revision and expiry; fixed 30-day wording was removed.

## Picker and daily actions

- Supplier filtering, design/code/colour search, bounded results, source dates/pages, all price bases, units and supplier VAT labels are visible together. Arrow keys move through results; Enter selects; Escape closes.
- Favourite and recently used fabric IDs live in additive preferences within the existing accounting snapshot. Recent selections are capped at ten. Removed catalog entries are ignored by the shortcuts.
- Daily actions cover overdue invoices, outstanding invoices with unknown due dates, expired/soon-expiring quotes, jobs awaiting materials, low stock, bank allocation exceptions and unmatched reviewed receipt evidence. Each opens its relevant record or existing review control.
- The queue reads all dates independently of the dashboard's financial month filter. Due dates are optional invoice fields; missing dates are not assumed overdue. Expiring quotes use a seven-day window. Jobs at Deposit received are treated as awaiting material ordering; explicit waiting material statuses are also included.
- The queue does not change ledger totals, reserve stock, order materials or send messages.

## Code and verification

The browser code is separated under `public/js/` into pricing arithmetic, fabric catalog/line handling, picker, calculator, document editor, document previews, quote history, quote list/conversion and dashboard modules. Styling is in `public/css/pricing.css`. The existing plain-script architecture and local server remain; no bundler or deployment requirement was introduced.

`npm test` now includes the catalog, pricing/history/dashboard and PDF-content checks. `npm run test:pricing` runs those checks alone. `npm run test:pricing:browser` runs the integration suite with installed Playwright/Edge; `UW_PLAYWRIGHT_MODULE` can select the bundled Playwright module.

Validation: 17 focused automated checks, expanded headless Edge integration tests, the full existing test suite, inline/module syntax and diff checks passed. Quote-form and actual PDF rendering were visually inspected. Tests use disposable state or intercepted browser saves; live financial data was not edited.

Storage mechanisms, migrations, authentication/security configuration and dependencies remain unchanged. Server changes are confined to quote PDF revision/validity wording. Business metadata and preferences use the existing JSON save/restore flow.

## Installed local application

The subsequent local-update request adds a code-only updater because Git pushes do not update the separate installation at `%LOCALAPPDATA%/UWAccountingSystem`. Run `npm run update:local` from the checkout after pulling or pushing the desired version. It checks dependency compatibility, backs up prior application code, replaces allowlisted assets, verifies file hashes, restarts the existing task and checks port 8080. It preserves `.env`, financial state, managed documents, installed dependencies and task configuration.

The Suppliers & Stock screen now shows all six source providers and their 1,421 selectable catalog entries independently of saved stock records. Catalog prices do not imply stock on hand. The browser footer identifies the installed Git revision. App-shell cache v38 includes every extracted module; the existing document cache remains v2. A newly activated shell reloads an idle app, while an open document form shows an update notice. Desktop/service startup and interactive npm startup open the local app automatically.
