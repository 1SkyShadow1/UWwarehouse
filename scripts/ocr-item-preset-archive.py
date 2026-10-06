"""Optional offline OCR for scanned quote/invoice candidates; keeps results local."""
import hashlib, json, sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import local
from pathlib import Path
import numpy as np
import pypdfium2 as pdfium
from PIL import Image

root = Path(sys.argv[1] if len(sys.argv)>1 else 'D:/UW')
audit = Path('tmp/item-preset-audit'); dest = audit / 'ocr'; dest.mkdir(exist_ok=True)
sys.path.insert(0, str(Path('tmp/fabric-audit/ocr-deps').resolve()))
from rapidocr_onnxruntime import RapidOCR
import cv2
cv2.setNumThreads(1)
worker_state = local()
report = json.loads((audit / 'audit.json').read_text(encoding='utf-8'))
candidates = [root / s['path'] for s in report['sources'] if s['status']=='needs OCR' and ('INVOICE' in s['path'].upper() or 'QUOTE' in s['path'].upper())]
candidates += [p for p in root.rglob('*') if p.is_file() and p.suffix.lower() in ('.jpg','.jpeg','.png') and ('INVOICES' in str(p).upper() or 'QUOTES' in str(p).upper())]
seen = set(); unique_candidates = []
for p in candidates:
    digest = hashlib.sha256(p.read_bytes()).hexdigest()
    if digest in seen or (dest / (digest+'.json')).exists(): continue
    seen.add(digest); unique_candidates.append((p,digest))
def process(candidate):
    p,digest=candidate
    if not hasattr(worker_state,'engine'): worker_state.engine=RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1)
    engine=worker_state.engine; rows = []; text = []; error = None
    try:
        if p.suffix.lower()=='.pdf':
            doc = pdfium.PdfDocument(p); images = []
            for page in doc: images.append(np.array(page.render(scale=2).to_pil())); page.close()
            doc.close()
        else:
            with Image.open(p) as image:
                image=image.convert('RGB');image.thumbnail((1800,1800));images=[np.array(image)]
        for image in images:
            results,_ = engine(image)
            if not results: continue
            groups = []
            for box, value, score in sorted(results, key=lambda r: (sum(point[1] for point in r[0])/4, r[0][0][0])):
                y = sum(point[1] for point in box)/4; height = max(point[1] for point in box)-min(point[1] for point in box)
                group = next((g for g in groups if abs(g['y']-y)<max(8,height*.45)), None)
                if group is None: group={'y':y,'cells':[]}; groups.append(group)
                group['cells'].append((box[0][0], value))
                text.append(value)
            rows.extend([[v for _,v in sorted(g['cells'])] for g in groups])
    except Exception as exc: error = str(exc)
    (dest / (digest+'.json')).write_text(json.dumps({'path':str(p.relative_to(root)), 'text':'\n'.join(text), 'rows':rows, 'error':error},ensure_ascii=False),encoding='utf-8')
    return p
with ThreadPoolExecutor(max_workers=4) as executor:
    futures=[executor.submit(process,c) for c in unique_candidates]
    for n, future in enumerate(as_completed(futures),1):
        future.result()
        if n%10==0: print(f'OCR reviewed {n}/{len(unique_candidates)} unique scanned candidates',flush=True)
print(f'Completed offline OCR for {len(candidates)} candidates ({len(seen)} new unique files)',flush=True)
