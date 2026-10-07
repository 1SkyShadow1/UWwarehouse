# Receipt review diagnostics — 7 October 2026

The receipt review regression came from clearing `GEMINI_API_KEY` during local-mode startup. Local mode must disable cloud **storage**, while retaining the existing Gemini document-review integration explicitly requested by the user. The protected key and master ledger were retained; neither was replaced.

## Corrections

- Preserve the server's existing Gemini key while keeping Supabase and Google Drive storage disabled.
- Return a non-retryable configuration error when no key exists; retain the uploaded source. Authentication/permission errors also stop immediately, while temporary provider failures retain bounded retries and model fallback.
- Preserve missing receipt amounts as blank rather than converting `null` to R0.
- Release v48 refreshes the browser application shell. Invoice/quote/receipt layouts, backup method, storage locations and authentication remain unchanged.

## Verification

- Full `npm test`: 44 Node tests and all sequential integration checks passed.
- Gemini integration fixtures explicitly run receipt review with `UW_LOCAL_ONLY=1`, confirming provider access works while cloud storage remains disabled. Model fallback retains source bytes; missing configuration and missing amounts have dedicated checks.
- Browser regression: quote/invoice/pricing flows plus receipt upload, Gemini extraction, preview and duplicate skipping passed without uncaught browser exceptions. These tests use disposable workspaces and a mocked provider.
- Installed v48: 99 application files verified, health healthy, Gemini configured, and master storage still `D:\UW FOREVER\Accounting Data\uw-state.json`. The code-only updater verified protected configuration and ledger were unchanged (revision 59).
- A live oversized historical PDF returns a clear size-limit message instead of a configuration failure. Documents over the existing 15 MB review limit require smaller page scans.
- Live review of a previously failed receipt image successfully returned its date, merchant and R1,819.35 total at 95% provider confidence. The extraction was discarded after inspection; no accounting record was posted or approved. This verifies the configured provider connection and confirmation screen, not the accuracy of every historical receipt.

The outstanding dependency, historical-source and shared-conflict findings in [the full audit](final-readiness-audit.md) still apply. Passing regression checks is not a guarantee against provider quota, connectivity failures or unresolved financial-source conflicts.

## Gemini duplicate checks — v49

Gemini now compares each scan with up to 400 existing reviewed scans using compact receipt metadata (merchant, receipt/invoice number, date and total). It returns possible existing record IDs; the server rejects invented IDs. Deterministic checks also compare the extraction with all reviewed server scans and the browser workspace, covering identical content, merchant plus receipt number, and merchant plus date and total. Matching amounts alone do not establish a duplicate. A rescan can therefore be flagged even when its filename or image bytes differ.

Potential duplicates are listed by filename and reason in the confirmation screen and scan register. They are retained for source comparison. Approval asks the operator to confirm that the receipt represents a separate transaction; nothing is automatically deleted or posted. Existing reviewed receipts have a **Check duplicates** action. Upload skipping now requires a real matching content hash, rather than assuming that equal filenames and sizes mean identical receipts.

Validation: 47 Node tests and all integration checks passed. Provider fixtures verify that Gemini receives candidate metadata and cannot invent match IDs. Browser checks verify rescan warnings, retained source records and cancellation of duplicate approval, alongside the existing pricing and document workflows.

## AI-assisted Delete duplicates — v50

The **Delete duplicates** button now asks Gemini to compare the active scan library's receipt metadata. It combines validated AI groups with deterministic receipt/content matches, then displays unchecked candidates, the original to retain, evidence and View actions. The operator selects confirmed duplicates and chooses **Remove selected duplicates**. Approved/included scans are protected and candidate changes are checked again before removal.

Removal archives the scan in the existing shared ledger by excluding it from active scans. The record and original source bytes remain intact; **Undo cleanup** restores each cleanup batch, including earlier batches in sequence. The obsolete destructive endpoint is no longer called by this feature. This also eliminates the previous local-first deletion on failed server requests. Normal shared-state conflict handling and incremental backups continue to protect pending work.

Provider failures/timeouts do not remove records. Gemini comparisons use existing extracted metadata; unreadable receipts still need individual document review before their contents can provide useful duplicate evidence. API fixtures check candidate-ID validation, while browser tests cover explicit selection, cleanup, Undo and provider failure without removing scans.

## Running indicators and receipt accuracy — v51

Receipt reviews, automatic upload reviews, Gemini batch reviews, FNB checks, duplicate analysis and cleanup saves display an animated spinner and persistent Running status. Batch status includes completed/total counts; the status remains visible when a progress dialog is closed. Conflicting review/cleanup actions are disabled while work is active, and success/failure clears the indicator. Reduced-motion settings and printed document layouts are respected.

Duplicate cleanup preserves one original when a receipt appears three or more times. Known contradictory merchants, receipt numbers, dates, totals or currencies prevent metadata-based cleanup suggestions, including AI groups. Candidates capture both records' identifying fields and approval state; changes after analysis invalidate removal. Save status distinguishes shared confirmation from locally retained work awaiting synchronization. Source files and Undo remain available in either case.

Verification: 49 Node tests plus all integration checks passed. Browser tests hold provider responses open to verify spinners, disabled buttons and rejection of overlapping requests; they also verify cleanup skips changed receipts, clears progress after failures, and restores removed copies. Individual Gemini review progress, duplicate cleanup and the existing pricing/document workflows passed without uncaught browser exceptions.
