# Document editor polish — 12 October 2026

Quote and invoice forms now offer the same main preset picker when creating or editing documents. Adding a preset retains existing lines. Saved custom lines are also searchable by category in the individual-line selector.

On successful document save, an uncoded line receives a readable code such as LAB-FRA-1, CON-GLU-1 or WIN-CHR-1. Existing catalogue/document codes are checked before allocating an unused numeric suffix. Identical saved descriptions and pricing facts reuse their preset code; a different rate/cost produces a separate preset rather than silently overwriting a rate. Manually entered and supplier codes are preserved. No preset is registered from a cancelled or invalid form.

Reusable preset facts are stored in the existing shared workspace under meta.savedItemPresets, keyed by code. No customer or source-document metadata is copied into the preset. Existing three-way sync merges independent keys and retains overlapping edits for conflict review, including concurrent conflicting allocations of the same readable code. Presets use the established save and backup paths; no storage or authentication configuration is changed.

New document lines, the pricing calculator and new manually entered fabrics default to 30% markup. Saved selling prices and deliberate stored overrides remain intact when editing. Supplier cost-plus pricing applies markup once. Reusing a saved preset retains its stored selling rate and known cost; it does not add another markup to the selling price. Historical presets retain their original selling rates and require current-rate confirmation.

System-generated quote, invoice and receipt previews/printing use Calibri 11 pt for body text, bold 12 pt section/table headings and bold Calibri 14 pt main headings. The local Windows PDF renderer embeds regular/bold Calibri from the existing Windows Fonts directory. Non-Windows hosts without Calibri retain the existing PDF font fallback. Original imported supplier/scanned documents are not reformatted.

Invoice column labels are now real table headers aligned with the code, description and amount cells. Quote description widths, right-aligned numeric columns, logo, document terms, lowered signature spacing and E&OE remain in place. The larger body font can require additional pages; long records continue to paginate rather than being compressed below the requested size.

Validation includes generated/reused codes, differing-rate presets, independent shared-profile preset merges, edit-form insertion without loss of existing lines, 30% cost-plus arithmetic, preserved existing overrides, document font sizes, embedded Calibri, and real PDF pagination for long records. Browser fixtures and generated preview PDFs use disposable data, not the production ledger.
