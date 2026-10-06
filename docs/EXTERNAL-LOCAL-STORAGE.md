# External local storage and document templates

The installed app uses its machine-specific `local-storage.json` configuration.
It is excluded from Git and preserved by the code updater. Existing `.env`
credentials and Brian/Evans password hashes remain unchanged.

Configured locations on this PC:

| Content | Location |
| --- | --- |
| Shared ledger, managed documents, encrypted sessions and conflict recovery | `D:\UW FOREVER\Accounting Data` |
| Verified daily recovery backups | `D:\UW FOREVER\Local Backups` |
| Invoice exports | `D:\UW FOREVER\Saved Invoices` |
| Quote exports | `D:\UW FOREVER\Saved Quotes` |
| Reference document library | `D:\UW FOREVER\Source Library\UW` |

Both profiles read and update the same authenticated local server. Revision
checks prevent stale writes; independent edits merge and overlapping edits
require review. Conflict recovery copies are saved on the data drive before a
user chooses which version to keep. Browser IndexedDB and localStorage are
recovery caches, not the authoritative database. A full localStorage cache no
longer prevents a server save or requires a second full copy in localStorage.

Local-only mode disables automatic Supabase/Google storage and external AI
requests without removing the existing integration credentials. Existing
server-side login, CSRF checks and AES-GCM session encryption remain enabled.
Keep the external drive connected: the app refuses to create an alternate
ledger when that drive is unavailable. The original installation data and
`D:\UW` source archive are retained after migration.

`scripts/migrate-external-local-storage.ps1` copies and hashes the source
library, stops the installed server for the ledger copy and path switch,
preserves the backup schedule, and restarts the local server. It refuses to
overwrite an existing destination ledger. The backup script accepts an external
data root and validates copies with its integrity manifest.

Invoices use the supplied Word template's three columns and Letter page size;
quotes use the supplied Excel template's four columns and A4 page size. Browser
previews, printing, receipts and invoice/quote PDF exports use the exact supplied
`public/uw-document-logo.png` bytes. The shared description formatter prints
material categories once, without combining distinct financial lines. Existing
source documents are kept as evidence; newly rendered documents use this layout.

Validation: full `npm test`, external-data backup test, isolated browser pricing
and template checks, real PDF pagination tests, and rendered invoice/quote proofs.
