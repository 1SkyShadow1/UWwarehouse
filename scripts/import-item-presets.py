"""Read the complete UW source archive; derive reusable lines without editing sources.

The audit (including source paths) is local only. The public catalog contains generic
item descriptions and historical source rates, never client/contact information.
"""
import argparse, collections, hashlib, json, re, zipfile
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET
import openpyxl
import pypdfium2 as pdfium

def number(value):
    if isinstance(value, (float, int)) and not isinstance(value, bool):
        return float(value)
    s = str(value or '').strip().replace('R', '').replace(' ', '').replace('\u00a0','')
    if ',' in s and ('.' not in s or s.rfind(',')>s.rfind('.')) and len(s.rsplit(',',1)[1])==2:
        s=s.replace('.','').replace(',','.')
    else: s=s.replace(',','')
    try:
        return float(s)
    except ValueError:
        return None

def category(description):
    explicit = re.search(r'(?:^|[-–—]\s*)(Fabric|Foam|Labour|Labor|Consumables|Delivery)\b', description, re.I)
    if explicit: return {'labor': 'Labour', 'labour': 'Labour'}.get(explicit[1].lower(), explicit[1].title())
    # Whole furniture jobs are not automatically treated as a material/labour rate.
    if re.search(r'chair|sofa|suite|couch|ottoman|recliner|wingback|seater|head.?board|re.?upholster', description, re.I): return 'Other'
    for pattern, label in [ (r'^fabric\b|^material\b|^suntex\b|^emperor velvet\b', 'Fabric'), (r'\bfoam\b|decron|dacron|comfortel|comforelle|comferel', 'Foam'), (r'\blabou?r\b|cut.*stitch|strip.*install', 'Labour'), (r'consumabl|\bglue\b|\bcotton\b|\bcot\s*[- ]?leather|end cap|bolt|washer|zip|staple|webbing|piping|thread|button|velcro|elastic|calico|lining|spunbond|batting|adhesive|screw|fastener', 'Consumables'), (r'deliver|transport|collection', 'Delivery') ]:
        if re.search(pattern, description, re.I): return label
    return 'Other'

def clean_desc(value):
    value = re.sub(r'^\d{4}\s*-?\s*\d{2}\s+', '', str(value or ''))
    value = re.sub(r'^FOAM(?=YELLOW|WHITE|PURPLE)', 'Foam - ',value,flags=re.I)
    return re.sub(r'\s+', ' ', value.replace('\ufffd', '-')).strip(' -–')

def source_date(text):
    match=re.search(r'(?:Date generated|DATE)\s*[:|]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})',text,re.I)
    if not match:return ''
    for fmt in ('%Y-%m-%d','%d/%m/%Y','%d-%m-%Y','%d/%m/%y','%d-%m-%y'):
        try:return datetime.strptime(match[1],fmt).date().isoformat()
        except ValueError:pass
    return ''

def priced_row(values):
    cells = [v for v in values if v is not None and str(v).strip()]
    # Standard four-column quote tables, with separate currency cells permitted.
    cells = [v for v in cells if str(v).strip() not in ('R', 'ZAR')]
    if len(cells) < 4: return None
    desc = clean_desc(cells[0]); nums = [number(v) for v in cells[1:]]
    if any(n is None for n in nums) or len(nums) != 3: return None
    qty, rate, total = nums
    if not (0 < qty < 100000 and 0 < rate < 1000000 and abs(qty * rate - total) <= max(.02, total * .00001)): return None
    if not re.search(r'[A-Za-z]{3}',desc) or len(desc) > 180 or re.search(r'total|deposit|balance|account|invoice|quote|@|\b0\d{9}\b', desc, re.I): return None
    item=category(desc)
    # Bulk invoice scans also contain groceries and unrelated business expenses.
    if item=='Other' and not re.search(r'chair|sofa|suite|couch|cushion|seat|ottoman|recliner|wingback|head.?board|lounge|patio|tractor|golf.?cart|lawnmower|panel|sandblast|powder.?coat|weld|frame|repair|manufactur|cover|plastic|sheet|fabric|leather|vinyl|wood|board|\blegs?\b|foot.?stool|carpet|mattress|\bbed\b|bench|pillow|curtain|tarp|awning|roof|lining|hood|re.?upholst|recover|\bfoam|comferel|capri|tuff.?hyde|clearout|burlington|polyprop',desc,re.I):return None
    return {'item': item, 'desc': desc, 'qty': qty, 'price': rate, 'basis': 'historical document unit rate'}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--root', default='D:/UW'); ap.add_argument('--audit', default='tmp/item-preset-audit'); ap.add_argument('--output', default='public/item-presets.js'); args = ap.parse_args()
    root = Path(args.root); audit_dir = Path(args.audit); audit_dir.mkdir(parents=True, exist_ok=True)
    corrections_file=Path(__file__).with_name('item-preset-corrections.json')
    corrections=json.loads(corrections_file.read_text(encoding='utf-8')) if corrections_file.exists() else {}
    files = sorted(p for p in root.rglob('*') if p.is_file()); counts = collections.Counter(p.suffix.lower() for p in files)
    audits = []; unique = {}; seen = {}; text_cache = audit_dir / 'texts'; text_cache.mkdir(exist_ok=True)
    (audit_dir / 'inventory.json').write_text(json.dumps([str(p.relative_to(root)) for p in files],ensure_ascii=False),encoding='utf-8')
    def add(line, source, location):
        if not line: return
        key = (line['item'], line['desc'].casefold(), line['price'])
        entry = unique.setdefault(key, {**line, 'qty': 1, 'sourceCount': 0, 'sourceId': source['id']})
        if source.get('date','')>entry.get('sourceDate',''):
            entry['sourceDate']=source['date'];entry['sourceId']=source['id']
        entry['sourceCount'] += 1
        source.setdefault('lines', []).append({**line, 'location': location})
    for index, path in enumerate(files):
        ext = path.suffix.lower()
        if ext not in ('.pdf', '.docx', '.xlsx', '.xps', '.jpg', '.jpeg', '.png'): continue
        if path.name.startswith('~$'):
            audits.append({'path': str(path.relative_to(root)), 'format': ext, 'status': 'temporary Office lock file'}); continue
        raw = path.read_bytes(); digest = hashlib.sha256(raw).hexdigest()
        if ext in ('.jpg', '.jpeg', '.png') and not (audit_dir / 'ocr' / (digest + '.json')).exists(): continue
        source = {'id': digest[:16], 'path': str(path.relative_to(root)), 'format': ext, 'status': 'read'}
        audits.append(source)
        if digest in seen:
            source['status'] = 'duplicate'; source['duplicateOf'] = seen[digest]; continue
        seen[digest] = source['path']
        try:
            rows = []; text = ''
            if ext == '.xlsx':
                book = openpyxl.load_workbook(path, read_only=True, data_only=True)
                for sheet in book:
                    # Actual used range; some templates contain formatted empty rows.
                    for row_index, row in enumerate(sheet.iter_rows(values_only=True), 1):
                        if any(v is not None for v in row): rows.append((list(row), f'{sheet.title}!{row_index}'))
                book.close(); text = '\n'.join(' | '.join(str(v) for v in row if v is not None) for row, _ in rows)
            elif ext == '.docx':
                with zipfile.ZipFile(path) as z: tree = ET.fromstring(z.read('word/document.xml'))
                ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
                text = '\n'.join(''.join(p.itertext()) for p in tree.findall('.//w:t', ns))
                for n, row in enumerate(tree.findall('.//w:tr', ns), 1):
                    rows.append(([''.join(t.text or '' for t in cell.findall('.//w:t', ns)) for cell in row.findall('w:tc', ns)], f'table row {n}'))
            elif ext == '.xps':
                pages = []
                with zipfile.ZipFile(path) as z:
                    for name in z.namelist():
                        if not name.lower().endswith('.fpage'): continue
                        tree = ET.fromstring(z.read(name)); groups = []
                        for glyph in tree.iter():
                            value = glyph.attrib.get('UnicodeString')
                            if not value: continue
                            pages.append(value); y = float(glyph.attrib.get('OriginY',0)); x = float(glyph.attrib.get('OriginX',0))
                            group = next((g for g in groups if abs(g['y']-y)<3),None)
                            if group is None: group={'y':y,'cells':[]};groups.append(group)
                            group['cells'].append((x,value))
                        rows.extend(([v for _,v in sorted(g['cells'])], name+' row '+str(n+1)) for n,g in enumerate(groups))
                text = '\n'.join(pages)
            elif ext == '.pdf':
                doc = pdfium.PdfDocument(raw); pages = [];source['pageCount']=len(doc)
                for n in range(len(doc)):
                    page = doc[n]; tp = page.get_textpage(); page_text = tp.get_text_range(); pages.append(page_text)
                    # Text-based four-column tables can have one cell per line.
                    lines = [clean_desc(s) for s in page_text.splitlines() if clean_desc(s)]
                    for pos, s in enumerate(lines):
                        match = re.match(r'^(.+?)\s+(\d+(?:\.\d+)?)\s+R?\s*([\d,]+\.\d{2})\s+R?\s*([\d,]+\.\d{2})$', s)
                        if match: rows.append((list(match.groups()), f'page {n+1} line {pos+1}'))
                        elif number(s) is None:
                            tail = [v for v in lines[pos+1:pos+7] if v != 'R'][:3]
                            if len(tail) == 3 and all(number(v) is not None for v in tail): rows.append(([s, *tail], f'page {n+1} line {pos+1}'))
                    tp.close(); page.close()
                doc.close(); text = '\n'.join(pages)
            # An optional local OCR pass supplies cells grouped by their page positions.
            ocr_file = audit_dir / 'ocr' / (digest + '.json')
            if ocr_file.exists():
                ocr = json.loads(ocr_file.read_text(encoding='utf-8'))
                text += '\n' + ocr['text']; rows.extend((r, 'OCR row '+str(n+1)) for n, r in enumerate(ocr['rows'])); source['ocr'] = True
            if digest in corrections:
                rows=[(r,'visually verified row '+str(n+1)) for n,r in enumerate(corrections[digest]['rows'])]
                source['visualReview']=corrections[digest]['review']
            (text_cache / (digest + '.txt')).write_text(text, encoding='utf-8')
            source['textLength'] = len(text)
            # Compilations contain separate invoices with different dates.
            source['date']=source_date(text) if source.get('pageCount',1)<=4 else ''
            is_document = bool(re.search(r'quotation|quote line items|\bINVOICE\b', text, re.I)) and not bool(re.search(r'recommended retail|trade pricelist|statement of account', text[:1800], re.I))
            source['document'] = is_document
            source['isQuote'] = bool(re.search(r'quotation|quote line items', text, re.I))
            for row,_ in rows:
                cells=[str(v).strip() for v in row if v is not None and str(v).strip()]
                if len(cells)>=2 and re.sub(r'[^a-z]','',cells[0].lower())=='projectreference':source['projectReference']=cells[1]
            if ext == '.pdf' and len(text.strip()) < 40: source['status'] = 'needs OCR'
            if is_document:
                for row, loc in rows: add(priced_row(row), source, loc)
        except Exception as exc: source['status'] = 'error'; source['error'] = str(exc)[:180]
        if index % 100 == 0: print(f'Reviewed {index+1}/{len(files)} archive files; {len(unique)} verified line presets', flush=True)
    # A material mentioned in a source is useful even when no isolated unit rate
    # exists. Leave that rate blank; never allocate a combined sundries total.
    terms = {'Consumables': ['End cap','Glue','Cotton','Bolts','Nuts','Washers','Webbing','Springs','Staples','Adhesive','Thread','Zips','Calico','Lining','Dust cover','Piping','Buttons','Velcro','Elastic','Screws','Fasteners','Spunbond','Batting'], 'Foam': ['High density foam','Yellow foam','Decron','Dacron','Comfortel','Comforelle'], 'Labour': ['Strip & Install frame','Cut & Stitch','Upholster']}
    # Cache keys use the full hash. Read only source documents, not supplier lists.
    document_ids = {s['id'] for s in audits if s.get('document')}
    document_text = '\n'.join(p.read_text(encoding='utf-8') for p in text_cache.glob('*.txt') if p.stem[:16] in document_ids)
    for label, words in terms.items():
        for word in words:
            if re.search(r'\b' + re.escape(word) + r'\b', document_text, re.I):
                desc = label + ' - ' + word
                if not any(p['desc'].casefold() == desc.casefold() for p in unique.values()):
                    unique[(label, desc.casefold(), None)] = {'item': label, 'desc': desc, 'qty': 1, 'price': None, 'basis': 'description observed; enter confirmed rate', 'sourceCount': 0}
    entries = sorted(unique.values(), key=lambda p: (p['item'], p['desc'].casefold(), p['price'] or 0))
    for p in entries:
        p['id'] = 'archive-' + hashlib.sha256(f"{p['item']}|{p['desc']}|{p['price']}".encode()).hexdigest()[:16]
        # Keep the product context in the picker, but print the category/detail once.
        match = re.search(r'(?:^|[-–—]\s*)(' + re.escape(p['item']) + r'\b.*)$', p['desc'], re.I)
        p['lineDesc'] = match[1] if match and p['item'] != 'Other' else p['desc']
    recipes = {}
    for source in audits:
        if not source.get('isQuote') or source.get('pageCount',1)>4: continue
        groups = collections.defaultdict(list)
        for line in source.get('lines',[]):
            match = re.match(r'^(.+?)\s[-–—]\s(?:Fabric|Foam|Labour|Consumables)\b',line['desc'],re.I)
            if match and line['item'] != 'Other': groups[match[1]].append(line)
        if not groups and source.get('projectReference')=='Prasa Train Seats':groups[source['projectReference']]=source.get('lines',[])
        for name, lines in groups.items():
            if len(lines)<2 or not any(p['item']=='Fabric' for p in lines): continue
            if not re.search(r'chair|sofa|suite|couch|cushion|seat|ottoman|wingback|head.?board|lounge|patio|tractor|golf cart|lawnmower|panel',name,re.I): continue
            prepared=[]
            for p in lines:
                m=re.search(r'\s[-–—]\s(' + re.escape(p['item']) + r'\b.*)$',p['desc'],re.I)
                prepared.append({'item':p['item'],'desc':m[1] if m else p['desc'],'qty':p['qty'],'price':p['price'],'sourceId':source['id']})
            # Source identity is not part of the duplicate recipe signature.
            signature=json.dumps([{k:v for k,v in p.items() if k!='sourceId'} for p in prepared],sort_keys=True)
            recipe_id='bundle-'+hashlib.sha256((name.casefold()+signature).encode()).hexdigest()[:16]
            recipes.setdefault(recipe_id,{'id':recipe_id,'code':'Historical bundle','desc':name,'lines':prepared,'sourceId':source['id'],'sourceDate':source.get('date',''),'total':round(sum(p['qty']*p['price'] for p in prepared),2),'originalJobQuantities':True})
    report = {'root': str(root), 'totalFiles': len(files), 'formats': dict(counts), 'sources': audits, 'presetCount': len(entries), 'recipeCount':len(recipes), 'statuses': dict(collections.Counter(a['status'] for a in audits))}
    (audit_dir / 'audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    output = {'generatedFrom': 'UW historical quotes and invoices', 'archiveFiles': len(files), 'presets': entries, 'recipes':sorted(recipes.values(),key=lambda p:(p['desc'].casefold(),p['total']))}
    Path(args.output).write_text('/* Historical source rates; confirm current pricing before use. */\nwindow.UW_ITEM_PRESETS=' + json.dumps(output, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('totalFiles', 'presetCount', 'recipeCount', 'statuses')}, ensure_ascii=False), flush=True)

if __name__ == '__main__': main()
