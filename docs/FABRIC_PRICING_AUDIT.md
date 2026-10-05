# Fabric pricing audit — 5 October 2026

The supplied lists now provide 1,421 selectable source entries. Deployment configuration, server code, storage mechanisms, database migrations, service-worker caches, authentication and security settings were not changed. Original supplier files and existing financial records were not rewritten.

## Source coverage

| Supplier | Entries | Source list | Price bases |
| --- | ---: | --- | --- |
| African Gameskin | 14 | African Gameskin .xlsx, titled PRICELIST 2025 | Square metre excluding VAT; approximate side/hide including VAT |
| Helm | 69 | June 2024 | Roll, cut, samples, conditional bulk and finishing extras, excluding VAT |
| Hertex | 711 | Recommended Retail, March 2026 | Recommended retail including VAT |
| Loomcraft | 279 | Trade, September 2025 | Roll/cut per running metre, excluding VAT |
| Sullies | 205 | June 2026 filename, printed 26 May 2026 | Cash price with both excluding/including VAT columns; unit unspecified |
| The Mill | 143 | Trade, 1 April 2026 | Roll/cut excluding VAT; genuine leather per square metre; MADAME per panel |

Counts preserve source rows, including 23 Hertex designs repeated in the self-lined/lining sections. They are distinguished by their source page and cannot double-count a document unless the user deliberately adds both as separate lines. The separately available Hertex June trade list was not substituted for the requested March retail list.

Every entry retains all extracted supplier table columns. This includes colour groups, composition, width, weight, abrasion, repeats, origin, care instructions, performance standards, seam slippage and tensile information where supplied. The Mill's embedded South African flags and finish symbols are captured as readable field values. Source filenames, dates, PDF pages or workbook rows, notes/terms and SHA-256 hashes are retained. The original document is accessible through the existing source viewer.

African Gameskin's unlabelled column E is shown as an unlabelled source value; it was not assigned an invented price basis. Its two GAZELLE colour groups retain separate prices and identities. The Mill leather averages do not become exact hide quotations. Loomcraft's three imitation-grass widths/pile variants remain separate running-metre items.

Loomcraft is image-only. All 279 roll/cut price pairs were visually checked against rendered originals, including unavailable cut prices and the R104.50 printed-vinyl cut price. Specification text was extracted with OCR and can contain minor transcription imperfections; the original document remains the reference for care and composition. The reviewed extraction is saved in `scripts/data/loomcraft-reviewed-cells.json` for repeatable imports.

## Behavior and fixes

- New and edited invoices/quotes share the same searchable supplier picker. Selection fills code, description and the listed unit rate. Cut prices are preferred where available; users can explicitly choose roll, sample, area, hide, panel or eligible bulk prices.
- The default is **As listed**. Including/excluding supplier VAT is an explicit arithmetic choice at 15%; already inclusive prices are not charged VAT twice. Sullies' printed inclusive prices are used directly. No markup is added automatically to supplier selections.
- Sullies' unit can be confirmed in the document form. Zero-priced entries require a confirmed price rather than silently becoming free material. Unavailable price bases cannot be selected. Approximate hides, stock checks and minimum/bulk conditions are displayed; entered quantities are checked against explicit minimums and bulk thresholds.
- Document lines retain supplier price snapshots, units and source provenance. Opening an editor preserves saved or manually overridden prices. Re-selecting the same fabric does not reset a chosen price basis. Quote conversion retains the same lines and rates.
- Shared row creation/collection replaces three separate implementations. Fractional quantities, cents and deliberate zero quantities survive edits. Blank prices, negative/non-finite values and unresolved fabric searches are rejected.
- The calculator now includes material measurement in the fabric line quantity. Previously, a calculation using three items at 2.5m each saved a fabric line of quantity 3 rather than 7.5. Generated detail lines now reconcile to the calculator total.
- Changing a price-book item refreshes its defaults. Quote preset refresh preserves a selected supplier fabric and its rate.
- Duplicate invoice/quote numbers are rejected. Renaming an invoice preserves receipt, job and quote links; renaming a quote preserves the generated invoice's source link.
- Unmodified historical fabric imports with automatic 100% markup are excluded from the new source catalog view. User-added or modified records are retained, with separate entered-cost and selling-price choices. Deleting a local record uses its identity rather than a potentially duplicated fabric code.

## Validation

Passed:

- `node --test scripts/test-fabric-catalog.js`: six data/calculation suites, including coverage, unique identities, retained amounts, VAT, unit exceptions, zero/unavailable rates, conditional prices, embedded specifications and custom records.
- `node scripts/test-fabric-browser.js`: headless Edge integration checks for all six suppliers, autofill, fractional quantities, invoice/quote edits, overrides, confirmed supplier units, leather units, duplicate designs, quote conversion, linked-record renaming, duplicate document IDs, missing prices, invalid choices, bulk eligibility, catalog filtering/restored-state availability, preset refresh and calculator reconciliation. No browser JavaScript exceptions occurred.
- `npm test`: existing server smoke checks passed, including document PDF export, state conflict handling and document upload/serving. Tests used disposable state and document directories.
- Inline JavaScript syntax and `git diff --check` passed. Quote-form and catalog screenshots were visually reviewed.

The browser suite requires Playwright and defaults to installed Microsoft Edge. `UW_PLAYWRIGHT_MODULE` may point to a supplied Playwright module; `UW_TEST_BROWSER` can select another installed supported browser. It uses a temporary read-only static server and intercepts application saves in memory, without connecting to the live backend.

Repeat the source import with Python, `pdfplumber` and `openpyxl`:

```text
python scripts/import-fabric-catalog.py --root D:/UW/2026/FABRIC --loomcraft-cells scripts/data/loomcraft-reviewed-cells.json
```

The importer updates only the catalog appended to the existing `public/operations-data.js` bundle. The supplier catalog is read at runtime alongside the existing user database, avoiding a bulk rewrite of saved state or loss when a prior snapshot is restored.

Before pushing, the fabric changes were rebased onto the six existing upstream commits, which moved application assets into `public/`. Importer and regression-test paths follow that layout; the upstream deployment, storage and security configuration was retained.

## Remaining limitations and out-of-scope findings

- Prices reflect the dated files supplied, not live supplier availability or current quotations. African Gameskin explicitly limits quotation validity and some suppliers identify discontinued stock. Actual hide sizes, Sullies units and bulk eligibility per colour require supplier confirmation.
- Existing saved quotes/invoices are not retroactively repriced. Legacy documents without a selected fabric retain their original amounts until explicitly edited.
- Existing PWA caching was deliberately unchanged. Hard-refresh the local browser (`Ctrl+Shift+R`) to load the updated HTML and operations bundle if the previous version remains visible. No factory reset is required.
- A read-only dependency audit reported five advisory-bearing packages: one high (`multer`) and four moderate (`gaxios`, `googleapis`, `googleapis-common`, `uuid`). These dependency versions were not changed, honoring the instruction to leave security changes out of scope. The missing local install was restored with `npm ci --ignore-scripts`, without modifying dependency manifests or the lockfile.
- `package.json` contains a duplicate `pdf-lib` key with the same version. It has no effect on this change and was left untouched with the dependency configuration.
- Task-generated extraction images/text and isolated OCR dependencies remain under `tmp/fabric-audit/`: automatic approval review rejected the cleanup command with a policy block and no further reason. These are temporary support files, not application changes or deliverables.

This is a detailed audit of the supplied pricing data and affected catalog, calculator, quote and invoice flows, plus the existing server regressions. It is not a guarantee that every unrelated accounting workflow has been exhaustively verified.
