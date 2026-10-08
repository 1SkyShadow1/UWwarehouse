# Financial production audit — 8 October 2026

Financial sign-off remains pending. Passing application tests does not resolve contradictory or incomplete accounting source evidence.

## Scope

Both user-supplied income workbooks were read with their original formulas and cached values. Reconciliation used an immutable copy of shared ledger revision 400, SHA-256 `348933bad054cd280183aee3ab8750e8824c866ecfacfede0b975ac25dcd94bc`. No source workbook or accounting record was changed by these audit scripts.

The local detailed report, row reconciliation and exception register are under `output/production-audit/`. They contain private financial evidence and are intentionally not committed.

## Findings requiring source reconciliation

- 64 distinct non-funding source rows were not matched under conservative identity rules: 44 from the supplied older workbook and 20 from the newer workbook. These are review candidates, not verified omitted revenue.
- Eight rows contradict full payment with outstanding/To Pay evidence. Historical workbook dates also disagree with dates encoded in document numbers; dates were not guessed from filenames or month tabs.
- 36 repeated source rows were identified and retained in the reconciliation output. Funding rows remain visible as evidence and were excluded from customer-income matching.
- 128 repeated invoice source copies are counted once by the existing ID rule. Ten repeated-ID groups disagree on metadata/payment/status. Another 52 groups appear similar under different IDs and require independent source review before deduplication.
- 106 imported job invoice links are unresolved; 11 job ID groups repeat; 159 distinct invoices have no linked saved job. Ambiguous ID-only edits now stop instead of changing the first job silently.
- 273 previously posted scan expenses lack explicit approval. Existing records were retained; new scan expenses require successful Gemini review and explicit approval/inclusion before automatic posting.
- Missing or zero line prices remain in 22 invoice/quote records. All 28 payable records lack confirmed amounts. Stock catalogue references cannot establish physical inventory; undated payroll estimates cannot prove paid wages.
- All 174 receipt entries link to existing invoices and their grouped amounts agree with the represented invoice collections. All 12 FNB statement credit/debit summaries and opening-to-closing arithmetic reconcile. This establishes ledger consistency, not payment authenticity or correct allocation.

## Corrections

AI derived financial summaries now share the unique-invoice reporting rules and include deposits. Expense bank matching rejects credits, merchant conflicts and a different transaction on explicitly linked FNB evidence. Live quote job details work, rejected/cancelled quotes do not inflate pending counts, and recent invoices sort by date within the active period.

Dashboard/report costs and net figures now identify their undated payroll estimate and invoice-date basis instead of certifying accounting profit. Provisional evidence warnings appear in both views. All-data report totals include all records independently of the displayed month window.

Live Brian dashboard totals agree with the captured snapshot. That check exposed repeated bank merchant parsing; transaction dates/amounts are now prepared once, merchant comparison runs only on amount/date candidates, and summary matches are reused. Receipt cross-reference counts also follow the selected financial month.

## Validation

The full automated suite, including financial regression tests, passes. Isolated browser checks cover all 19 screens against the read-only audit snapshot plus quote/invoice pricing, receipt upload, Gemini extraction responses, document preview and duplicate handling. Provider responses are fixtures; this does not certify a successful live Gemini bulk request.

`npm audit` still reports one high and four moderate dependency advisories. Dependencies, security settings, storage paths and deployment configuration were not altered. Local server health confirms durable local storage on D:. The browser was signed out at the initial audit; Brian subsequently signed in and his dashboard was checked.

## Reproduce

Read-only commands (use the configured bundled runtimes if Python/Node are not on PATH):

```text
python scripts/audit-income-ledger.py --state SNAPSHOT.json --output output/production-audit "D:/UW/2025/INCOME/INCOME.xlsx" "D:/UW/2026/INCOME/INCOME 2026 O.xlsx"
node scripts/audit-financial-controls.js SNAPSHOT.json output/production-audit/reporting-controls.json
npm test
```

For isolated browser coverage, set `UW_PLAYWRIGHT_MODULE` to Playwright, `UW_AUDIT_STATE` to the immutable snapshot and `UW_AUDIT_EXPECTED` to `financial-audit.json`, then run `node scripts/test-fabric-browser.js`. Source hashes and snapshot revision must match when comparing results.
