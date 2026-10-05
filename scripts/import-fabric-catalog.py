"""Read supplier originals; append a static catalog to the existing operations bundle.

Requires pdfplumber/openpyxl. Image-only Loomcraft input uses reviewed OCR cell JSON
provided with --loomcraft-cells. No source files, user state or server settings change.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

MARKER = '// BEGIN SUPPLIER FABRIC CATALOG'


def clean(value):
    return re.sub(r'\s+', ' ', str(value or '')).strip()


def money(value):
    text = clean(value).replace('R', '').replace(' ', '').replace(',', '')
    match = re.fullmatch(r'\d+(?:\.\d+)?', text)
    return float(text) if match else None


def build(root, loomcraft_cells):
    import openpyxl
    import pdfplumber
    records, sources, identities = [], {}, {}

    def source(key, supplier, relative, date, notes=''):
        path = root / relative
        sources[key] = dict(supplier=supplier, name=path.name, path=str(path), date=date,
                            sha256=hashlib.sha256(path.read_bytes()).hexdigest(), notes=notes)
        return path

    def price(key, label, amount, vat, unit='m', **extra):
        return dict(key=key, label=label, amount=amount, vat=vat, unit=unit, **extra)

    def add(key, page, code, desc, fields, prices, **extra):
        variant = fields.get('COLOURS AVAILABLE') or fields.get('RANGE / ALTERNATIVE NAME') or fields.get('RANGE') or fields.get('Collection') or ''
        width = fields.get('WIDTH') or fields.get('WIDTH CM') or fields.get('Width (cm)') or fields.get('USEABLE WIDTH') or ''
        identity = f'{key}|{page}|{code}|{desc}|{variant}|{width}'
        occurrence = identities.get(identity, 0)
        identities[identity] = occurrence + 1
        identity += f'|{occurrence}'
        records.append(dict(id='fabric-' + hashlib.sha256(identity.encode()).hexdigest()[:16],
                            supplier=sources[key]['supplier'], sourceId=key, page=page,
                            code=code, desc=desc, fields=fields, prices=prices, **extra))

    p = source('gameskin', 'African Gameskin', 'AFRICAN GAMESKIN/African Gameskin .xlsx', '2025',
               'Workbook is titled PRICELIST 2025. Prices are quotations, ex works, subject to change and volume; valid for one month after receipt. Approximate hide price is not a measured hide quotation. Column E has no heading and is preserved without assigning a price basis.')
    workbook = openpyxl.load_workbook(p, data_only=True)
    for sheet in workbook:
        for row_number, row in enumerate(sheet.values, 1):
            if len(row) < 6 or not isinstance(row[2], (int, float)):
                continue
            fields = {'Design': clean(row[0]), 'PRICE/M2 EX VAT': row[2],
                      'APPROX. PRICE PER SIDE/HIDE (INCL VAT)': row[3],
                      'Unlabelled column E (source value)': row[4], 'COLOURS AVAILABLE': clean(row[5])}
            add('gameskin', row_number, clean(row[0]), clean(row[0]), fields,
                [price('area', 'Per square metre', row[2], 'excl', 'm²'),
                 price('hide', 'Approx. side/hide', row[3], 'incl', 'side/hide', approximate=True)],
                sheet=sheet.title, colours=clean(row[5]))

    p = source('helm', 'Helm', 'HELM/Helm price list - June 2024.pdf', '2024-06',
               'All prices exclude VAT. Sample cost is refunded when 25m of fabric within the same range is ordered. Preserve roll-only, minimum order and discontinued-stock restrictions.')
    headers = ['Code', 'Collection', 'Collection Name', 'Roll Price', 'Cut length price', 'Sample Price',
               'Width (cm)', 'Weight (gms)', 'Composition', 'Rubs', 'Origin', 'Cleaning Instructions', 'Additional Notes']
    previous = None
    with pdfplumber.open(p) as pdf:
        for page_number, page in enumerate(pdf.pages, 1):
            for table in page.extract_tables():
                for raw in table:
                    if len(raw) != 13 or not (money(raw[3]) is not None or money(raw[4]) is not None):
                        continue
                    row = [clean(x) for x in raw]
                    # Two known cell-boundary failures, verified against page text/render.
                    if row[0] == '10865 - 10868':
                        row[5], row[6] = 'R135.00', '140'
                    if row[0] == '10629 (66144)':
                        row[6:10] = ['145', '548', '100% Polyester', '50 000']
                    if row[1].startswith('orders over') and previous:
                        previous['prices'].append(price('bulk-' + row[1].split()[2],
                            row[1] + ' ' + row[2] + ' (COD)', money(row[3]), 'excl',
                            minimumExclusive=float(row[1].split()[2].rstrip('m'))))
                        previous['fields'][row[1]] = ' '.join(row[2:6])
                        continue
                    fields = dict(zip(headers, row))
                    choices = [price('roll', 'Roll', money(row[3]), 'excl'),
                               price('cut', 'Cut length', money(row[4]), 'excl'),
                               price('sample', 'Sample', money(row[5]), 'excl', 'sample')]
                    if row[5] == 'No Cost':
                        choices[2]['amount'] = 0
                    minimum = re.search(r'Minimum (?:order|Order) (\d+)m', row[12])
                    if minimum:
                        for choice in choices[:2]:
                            choice['minimum'] = int(minimum.group(1))
                    if 'Only 1m+' in row[12]:
                        for choice in choices[:2]:
                            choice['minimum'] = 1
                    add('helm', page_number, row[0], clean(' '.join([row[1], row[2]])), fields, choices)
                    previous = records[-1]

    p = source('hertex', 'Hertex', 'HERTEX/Retail/Hertex Recommended Retail Fabric Price List March 2026.pdf', '2026-03')
    headers = ['DESIGN', 'RANGE', 'BRAND', 'RECOMMENDED RETAIL PRICE (INCL VAT)', 'WIDTH', 'COMPOSITION', 'REPEAT (APPROX)']
    with pdfplumber.open(p) as pdf:
        sources['hertex']['notes'] = '\n\n'.join(page.extract_text() or '' for page in pdf.pages[18:])
        for page_number, page in enumerate(pdf.pages, 1):
            for table in page.extract_tables():
                for raw in table:
                    if len(raw) == 7 and money(raw[3]) is not None:
                        row = [clean(x) for x in raw]
                        add('hertex', page_number, row[0], row[0], dict(zip(headers, row)),
                            [price('retail', 'Recommended retail', money(row[3]), 'incl')],
                            needsStockConfirmation='*' in row[0])

    p = source('sullies', 'Sullies', 'SULLIES/SULLIES PRICE LIST - JUNE 2026.pdf', '2026-06',
               'Department MATERIAL, CASH SALE. Source print timestamp: 2026-05-26 11:21:02. The document does not specify the selling unit; confirm whether metres, area or another unit before calculating. Zero price entries require supplier confirmation.')
    with pdfplumber.open(p) as pdf:
        for page_number, page in enumerate(pdf.pages, 1):
            # Extract each half-page independently to preserve codes containing spaces.
            for left, right in [(0, page.width / 2), (page.width / 2, page.width)]:
                for line in (page.crop((left, 0, right, page.height)).extract_text() or '').splitlines():
                    match = re.fullmatch(r'(.+?)\s+(\d+\.\d{2})\s+(\d+\.\d{2})', line.strip())
                    if not match:
                        continue
                    prefix, ex, inc = match.groups()
                    tokens = prefix.split()
                    code_count = 2 if tokens[:2] in [['PANO', '2'], ['NEW', '2']] else 1
                    code, desc = ' '.join(tokens[:code_count]), ' '.join(tokens[code_count:])
                    add('sullies', page_number, code, desc,
                        {'Department': 'MATERIAL', 'Code': code, 'Description': desc, 'Excl VAT': float(ex), 'Incl VAT': float(inc)},
                        [price('cash', 'Cash sale', float(ex), 'excl', 'unit', amountIncl=float(inc))],
                        needsPriceConfirmation=float(ex) == 0, unitUnspecified=True)

    p = source('mill', 'The Mill', 'THE MILL/THE MILL Trade Pricelist 1st April 2026.pdf', '2026-04-01')
    headers = ['DESIGN', 'RANGE', 'TRADE ROLL PRICE *EX VAT', 'TRADE CUT PRICE *EX VAT', 'COMPOSITION',
               'WIDTH CM', 'REPEAT CMS', 'WEAVE DIRECTION', 'ABRASION RUBS', 'SEAM SLIPPAGE WARP',
               'SEAM SLIPPAGE WEFT', 'TENSILE WARP', 'TENSILE WEFT', 'LIGHT/COLOUR FASTNESS', 'STANDARD', 'CARE/FINISH', 'WOVEN IN SA']
    with pdfplumber.open(p) as pdf:
        sources['mill']['notes'] = pdf.pages[-1].extract_text() or ''
        for page_number, page in enumerate(pdf.pages[:-1], 1):
            for table in page.find_tables():
                for row_index, raw in enumerate(table.extract()):
                    if len(raw) == 17 and (money(raw[2]) is not None or money(raw[3]) is not None):
                        row = [clean(x) for x in raw]
                        # Flags and finish symbols are embedded images, absent from text extraction.
                        for column in [15, 16]:
                            cell = table.rows[row_index].cells[column]
                            if cell is None:
                                continue
                            left, top, right, bottom = cell
                            for image in page.images:
                                x = (image['x0'] + image['x1']) / 2
                                y = (image['top'] + image['bottom']) / 2
                                if left < x < right and top < y < bottom:
                                    if column == 16:
                                        row[column] = 'Yes (South African flag in source)'
                                    else:
                                        digest = hashlib.sha256(image['stream'].get_data()).hexdigest()[:12]
                                        symbol = {'09467cfd8a77': 'spillBLOCK', '82a16d704b87': 'Throw Quality Stain repellent'}.get(digest, 'Finish symbol (see source)')
                                        if symbol not in row[column]:
                                            row[column] = clean(row[column] + ' ' + symbol)
                        choices = [price('roll', 'Trade roll', money(row[2]), 'excl'), price('cut', 'Trade cut', money(row[3]), 'excl')]
                        if 'Price per sqmt' in row[3]:
                            choices = [price('area', 'Per square metre (full hides only)', money(row[2]), 'excl', 'm²')]
                        if row[2] == 'Panels Only':
                            choices = [price('panel', 'Panel only', money(row[3]), 'excl', 'panel')]
                        add('mill', page_number, row[0], row[0], dict(zip(headers, row)), choices,
                            needsStockConfirmation='**' in row[0])

    source('loomcraft', 'Loomcraft', 'LOOMCRAFT/LOOMCRAFT TRADE PRICELIST SEPT 2025.pdf', '2025-09')
    loom = json.loads(Path(loomcraft_cells).read_text(encoding='utf-8'))
    sources['loomcraft']['notes'] = loom['notes']
    for row in loom['rows']:
        fields = row['fields']
        add('loomcraft', row['page'], fields['DESIGN'], fields['DESIGN'], fields,
            [price('roll', 'Trade roll', row['roll'], 'excl'), price('cut', 'Trade cut', row['cut'], 'excl')],
            extraction='OCR; price cells visually checked')

    counts = {key: sum(r['sourceId'] == key for r in records) for key in sources}
    if any(count == 0 for count in counts.values()):
        raise ValueError(f'Empty supplier catalog: {counts}')
    return dict(version='supplier-lists-2026-10-05-v1', sources=sources, fabrics=records, counts=counts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default='D:/UW/2026/FABRIC')
    parser.add_argument('--loomcraft-cells', required=True)
    parser.add_argument('--output', default='public/operations-data.js')
    args = parser.parse_args()
    catalog = build(Path(args.root), args.loomcraft_cells)
    output = Path(args.output)
    original = output.read_text(encoding='utf-8-sig').split(MARKER)[0].rstrip()
    payload = json.dumps(catalog, ensure_ascii=False, separators=(',', ':'))
    output.write_text(original + '\n\n' + MARKER + '\nwindow.UW_FABRIC_CATALOG = ' + payload + ';\n', encoding='utf-8')
    print(json.dumps(catalog['counts']))


if __name__ == '__main__':
    main()
