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
