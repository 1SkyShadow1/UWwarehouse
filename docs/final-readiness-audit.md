# Final local-system audit — 7 October 2026

Release: `2026-10-07-final-audit-v47`.

The tested local workflows pass, but an unconditional production sign-off is withheld until the outstanding dependency and source-data findings below are addressed. Deployment configuration, authentication, dependency versions, storage locations and document designs were preserved.

## Corrections

- Successful periodic cache writes no longer log a false failure.
- Global Save distinguishes a durable accounting save from a failed invoice/quote PDF export. Failed exports retry on a subsequent save in the running server; missing PDF files are recreated on a subsequent save. An existing stale PDF following a server restart after an export failure still needs explicit verification.
- Current BB/SS document numbers must continue matching their dates when edited. Historical identifiers are retained. New or changed invoice due dates cannot precede the invoice date.
- Customer, contact, email and project text survives quotation marks in the invoice editor.
- Historical invoices with multiple source copies remain editable under their unchanged number.
- Invoice lists, income views, assistant summaries and month-end CSV exports use the same existing first-record-per-invoice-number policy as the dashboard and reports. Duplicate source records remain stored. Collected amounts include deposits.
- Document dates and report/filter months use the computer's local calendar, avoiding UTC day/month shifts in South Africa.
- Removed a duplicate `pdf-lib` declaration without changing the dependency lockfile or installed packages.
- Updated the application cache/version to v47 so the corrections reach the installed browser.

## Verification

- `npm test`: 42 Node tests plus all sequential integration checks passed. Coverage includes supplier pricing, document numbering and source recovery, preset selection, PDF layout/pagination, code-only installation, shared-profile concurrency, local disk storage, browser quota recovery, authentication/CSRF validation, state persistence/restarts, upload validation and API error responses.
- Browser regression suite passed without uncaught browser exceptions: material selection and automatic pricing, markup/margin, manual overrides, quote editing/acceptance/conversion, recovered quote previews, presets and responsive forms.
- Python extraction checks: 2 quote-recovery tests and 6 preset-import tests passed.
- Backup fixture tests passed, including hash verification and rejection of a modified backup file. These are integrity/copy checks, not a full disaster-recovery rehearsal on a separate machine.
- A real previous backup verified: `D:\UW FOREVER\Local Backups\UWAccounting-20261006-091423-907`, 3,987 files / 2,339,860,266 bytes.
- Fresh full backup created and verified using the existing procedure: `D:\UW FOREVER\Local Backups\UWAccounting-20261007-090558-047`, 4,012 files / 2,344,879,181 bytes. The source ledger and original full backup were retained.
- Read-only live health checks confirmed local-only operation and the authoritative ledger at `D:\UW FOREVER\Accounting Data\uw-state.json`. D: reports Healthy with approximately 980 GB available. The local-server task is Running; the daily-backup task is registered.
- Live ledger at audit: revision 52, 512 invoice source rows / 384 invoice numbers, 71 quotes / 240 quote lines, zero quote introduction/line placeholders beginning with Imported. No live accounting records were changed by this audit.

## Outstanding production findings

1. **Dependency advisories.** `npm audit --omit=dev --json` reports 5 affected package entries: 1 high (`multer`) and 4 moderate (`uuid` and its Google API dependency chain). These are package entries, not five independent advisories. Multer has upload denial-of-service advisories; the Google chain includes a UUID buffer-bounds advisory. Dependency changes were excluded under the user's instruction to preserve security and the installed setup. Relevant upstream advisories: [Multer](https://github.com/advisories/GHSA-535w-7cp7-47q4), [UUID](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Local-only operation does not eliminate the need to resolve these findings before production sign-off.
2. **Source pricing requires review.** Six recovered quotes retain explicit warnings: `MG27022401` (Bed box rate missing), `BB10062401` (source total conflicts with priced lines), `RP03022501` and `RP31012501` (alternative options), `BB12042602` (Three Seater labour rate missing), `BB30032601` (source total blank). Unknown prices were not invented. Review the source evidence and required options before issuing these documents.
3. **Duplicate source metadata.** 128 invoice numbers have two stored source records. Their line totals agree, but source/contact/item metadata differs; 7 groups differ in financial-year metadata and 3 in status. Reporting now avoids counting either number twice, using the established dashboard policy. A reviewed source reconciliation is still needed; the audit did not delete or automatically merge the records.
4. **Preserved profile conflict.** A shared-edit conflict was present in the browser during the prior session. This audit did not automatically choose between financial copies. Review any retained conflict in Settings before relying on that browser's workspace. Isolated tests confirm both authenticated profiles share server records and reject conflicting stale writes; they do not resolve an existing user's conflict.

## Final installed verification

The existing code-only updater installed code commit `d6ca541` and verified 95 installed-file hashes. Five key files fetched from port 8080 matched the repository bytes. The browser login screen displayed `2026-10-07-final-audit-v47`, with no recent warning/error logs. It was already signed out; this audit did not enter credentials or manipulate live financial forms. Authenticated end-to-end flows were checked in disposable test workspaces.

The live server remained local-only and healthy, rejected an unauthenticated ledger request with HTTP 401, and answered ten health requests with a median of 27 ms (maximum 257 ms while the backup was running). These timings measure health requests, not a full load test. The code updater verified that the ledger and protected configuration stayed unchanged; ledger revision remained 52.

The subsequent user-requested backup improvement replaced repeated full copies with content-addressed incremental snapshots. The original scheduled task and its timing were retained; two triggered scheduled runs completed with result 0, resolving the previously failed task check. A separately verified baseline and a second run adding only 49,995 bytes are recorded in [the incremental backup guide](incremental-backups.md). Existing full backups, the live ledger, configuration and document layouts were retained.
