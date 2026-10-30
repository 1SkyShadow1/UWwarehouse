The quote editor combines the existing price book with reusable lines extracted
from historical quotes and invoices in the UW archive. Search by product or
material and filter by Item category. In a quote, selecting any of the available
presets immediately adds its saved line or component lines. Complete-item and
historical job presets include the product name in each component description;
standalone material and work presets retain their own descriptions. Existing
lines and entered notes are retained. Invoice forms retain the explicit
**Add preset lines** action.

Historical job bundles keep their original line quantities. The quantity field
becomes a job multiplier when one is selected; it does not infer how many metres
or consumables a different furniture size will need. Review those measurements
before applying the bundle to a new job.

Each line has an Item category. Supplier, fabric, price basis, supplier VAT and
fabric colour controls apply only to **Fabric**. Changing a supplier-priced Fabric
line to another category clears its supplier snapshot and calculated rate.
Labour, Foam, Consumables, Delivery and Other lines can use category-specific
historical choices or an entered description. Complete-item quote descriptions
include the product followed by its category and detail.

Fabric colours can be selected from the palette or entered freely. A colour
choice is a specification, not a claim that a supplier has it in stock.

Historical source rates are reference values. They are not automatically recorded
as internal costs. Check current selling prices before issuing a quote. Descriptions
found without a separate unit rate require a confirmed price entry. Combined
material charges are not divided into invented individual consumable prices.
Selecting a supplier fabric uses the existing catalog's explicit price, unit and
VAT basis, retaining a source snapshot on the saved line.

Archive extraction is read-only. `scripts/import-item-presets.py` reads PDF, XLSX,
DOCX and XPS documents, checks quantity × rate against the listed total, and
deduplicates identical source files and identical description/rate combinations.
The optional `scripts/ocr-item-preset-archive.py` checks scanned invoice and quote
candidates using the existing local RapidOCR runtime; no remote service is used.
Only derived item descriptions, rates and opaque source identifiers are bundled.
The local audit and inventory under `tmp/item-preset-audit` retain original paths
and source rows. No source documents or existing ledger records are rewritten.

Verification includes importer arithmetic/classification tests, browser checks
for category gating, custom colours and retained lines, the existing pricing and
shared-profile regression suites, and visual PDF pagination checks.
