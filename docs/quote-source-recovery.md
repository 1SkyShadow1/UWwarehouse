New invoices and quotes use BB or SS followed by YYMMDD and a daily sequence:
`BB26100701` is the first BB invoice or quote for 7 October 2026. Each document
type and prefix has its own sequence. Date or initials changes regenerate the
number, and saves reject duplicate numbers within that document type. Existing
historical identifiers and links remain unchanged.

The 71 historical quote workbooks were read from their original source paths.
The recovered bundle contains 240 original lines, introductions, customer/contact
details, project references, prepared-by names and source expiry dates. Source
paths are kept as metadata, not printed as introductions. Recovery fills only
blank/placeholder fields and replaces lines only when every line is a placeholder.
It does not add deleted records, change invoices or overwrite manually edited
lines. A version marker prevents reapplying the repair after subsequent edits.
The server applies this repair once through the existing atomic ledger write and
revision mechanism; browser startup uses the same pure repair function.

Missing source unit prices stay blank and print as a dash. Source-total
discrepancies and alternative options remain visible as review messages in the
quote editor. Alternatives must be selected and discrepancies checked before
acceptance; confirming the editor review clears the message. No prices are
invented and no source workbooks are modified. Local extraction audit files retain
source hashes, original imported totals and reconciled line totals.

Checks: `scripts/test-document-numbers-and-recovery.js`,
`scripts/test-quote-recovery-extraction.py`, the browser pricing workflow suite,
and the existing full regression suite. The browser suite checks every recovered
quote preview for actual introduction text and the correct number of lines.
