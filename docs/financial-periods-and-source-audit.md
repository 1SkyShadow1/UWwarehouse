# Financial periods and expense source audit — 9 October 2026

The shared date selector now supports the current year from January through the local calendar date, complete years from 2024, and individual months. Income, expense categories, recent invoices, FNB reconciliation and receipt cross-reference use the same period predicate. Invalid dates are excluded from selected periods. All recorded dates retains undated and older source evidence; a selected period excludes undated aggregate payroll estimates rather than inventing a payment date.

The transaction date determines the period, independently of folder name or imported financial-year metadata. Daily operational actions remain independent of financial periods.

A recursive read-only audit of D:/UW/2025 and D:/UW/2026 inventories every file with SHA-256, extracts distinct supported documents and reconciles identifiable expense worksheet rows. Every repeated file path and worksheet row remains in the reports. It never posts an amount or deletes a suspected duplicate.

The audit captured ledger revision 778 and found 3,036 files, 1,365 distinct file hashes and 1,671 byte-identical copies. The recognizable expense worksheets contain 508 dated amount rows: 228 distinct rows match ledger identity and amount, and 280 repeat existing source rows. The source expense books contain 2024 transactions despite their containing folders being named 2025 and 2026.

Recorded category arithmetic matches the application: Consumables R303,045.79 and Other R229,278.61. Two matched CHAMDOR material rows totaling R790.55 are classified Other and require category review. Existing scanned expenses without approval remain provisional, and three receipt records dated 2000/2021 require source-date review. No financial record was changed.

This is an evidence and reconciliation audit, not proof of every payment. Many invoice/quote documents are not expense evidence. Image-only or unsupported documents remain unresolved without visual/Gemini review. Extracted PDF/Word text alone does not certify monetary interpretation. Office owner lock files are inventory entries, not corrupt accounting documents. Private row-level evidence remains outside Git under output/expense-audit-2026-10-09 and the external Accounting Audits directory.

Validation covers date boundaries, future-date exclusion in January-to-date, invalid dates, monthly/yearly receipts, persisted period selection between dashboard and expenses, and actual dashboard totals against a read-only snapshot. Existing quoting, receipt review, document layout, storage, security and startup configuration are preserved.

Reproduce with the bundled Python runtime:

```text
python scripts/audit-expense-sources.py --state SNAPSHOT.json --output OUTPUT_DIRECTORY D:/UW/2025 D:/UW/2026
```
