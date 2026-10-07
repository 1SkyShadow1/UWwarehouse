"""Recover original workbook content; never edit source workbooks or the live ledger."""
import argparse, hashlib, json, re
from pathlib import Path
from datetime import date, datetime
import openpyxl

def text(value):
    return str(value or '').strip().replace('\ufffd', '•')

def numeric(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool): return float(value)
    value=text(value).replace('R','').replace(' ','').replace('\xa0','')
    if ',' in value and ('.' not in value or value.rfind(',')>value.rfind('.')) and len(value.rsplit(',',1)[1])==2:
        value=value.replace('.','').replace(',','.')
    else: value=value.replace(',','')
    try: return float(value)
    except ValueError: return None

def extract(path):
    book=openpyxl.load_workbook(path,data_only=True)
    sheet=next((s for s in book if any('quote line items' in text(v).lower() for row in s.values for v in row)),book.active)
    rows=list(sheet.values); result={}; introduction=[]; items=[]; in_intro=False; columns=None; total=None; pending=[]; warnings=[]
    labels={'client account name':'customer','client contact name':'contact','client telephone':'phone','client email':'email','billing address':'billingAddress','project reference':'projectReference','prepared by':'preparedBy','expiry date':'expiry'}
    for row in rows:
        cells=[(i,v) for i,v in enumerate(row) if v is not None and text(v)]
        if not cells: continue
        for index,value in cells:
            key=re.sub(r'\s+',' ',text(value).lower()).rstrip(':')
            if key in labels:
                # A merged field's value is immediately after its label. Do not
                # accidentally use the quote/date label from the next panel.
                raw=row[index+1] if index+1<len(row) else None
                result[labels[key]]=raw.date().isoformat() if isinstance(raw,datetime) else raw.isoformat() if isinstance(raw,date) else text(raw)
        first=text(cells[0][1]); lower=first.lower()
        if 'introduction, notes and specifications' in lower: in_intro=True; continue
        if 'quote line items' in lower: in_intro=False; continue
        if in_intro: introduction.append('\n'.join(text(v) for _,v in cells)); continue
        headers={text(v).lower():i for i,v in cells}
        if 'description' in headers and 'qty' in headers:
            columns=[headers[k] for k in ('description','qty','unit price','total price')]; continue
        if columns is None: continue
        if re.fullmatch(r'\*?\s*total',lower):
            total=numeric(row[columns[3]]); columns=None; continue
        if 'acceptance of quotation' in lower: columns=None; continue
        description=text(row[columns[0]])
        qty,price,line_total=[numeric(row[i]) for i in columns[1:]]
        if qty is None and price is None and (line_total is None or line_total==0):
            if description:
                if description.upper()=='OR': pending.append('OR'); warnings.append('Source lists alternative options; select the required option before issuing')
                elif items: items[-1]['desc']+='\n'+description
                else: pending.append(description)
            continue
        if not description and not pending and qty==0 and (price or 0)==0: continue
        if qty is None: raise ValueError('Missing quantity: '+description)
        if price is None:
            warnings.append('Source has no unit price: '+description); price=''
        if price!='' and line_total is not None and abs(qty*price-line_total)>.02: raise ValueError('Line total mismatch: '+description)
        description='\n'.join([*pending,description]).strip();pending=[]
        if not description: raise ValueError('Missing line description')
        items.append({'desc':description,'qty':qty,'price':price})
    book.close()
    result['introduction']='\n'.join(introduction); result['notes']=result['introduction']; result['items']=items
    if not result.get('customer'): result['customer']=result.get('contact','')
    calculated=round(sum(i['qty']*(i['price'] or 0) for i in items),2)
    if pending: result['introduction']+='\n'+'\n'.join(pending); result['notes']=result['introduction']
    if total is not None and abs(calculated-total)>.02: warnings.append(f'Source total {total} differs from priced lines {calculated}')
    if total is None: warnings.append('Source total is blank; priced lines are shown')
    result['sourcePricingWarnings']=warnings
    if not items: raise ValueError('No quote lines recovered')
    return result, {'sourceTotal':total,'lineTotal':calculated,'lineCount':len(items),'warnings':warnings,'sourceHash':hashlib.sha256(Path(path).read_bytes()).hexdigest()}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--input',default='tmp/quote-recovery-input.json');parser.add_argument('--output',default='tmp/quote-recovery.json');args=parser.parse_args()
    recovered=[];errors=[]
    for quote in json.loads(Path(args.input).read_text(encoding='utf-8')):
        path=quote.get('sourceWorkbook') or quote.get('notes','').removeprefix('Imported from ')
        try:
            content,audit=extract(path)
            recovered.append({'id':quote['id'],'content':content,'sourceWorkbook':path,'audit':audit,'previousTotal':sum(i['qty']*i['price'] for i in quote['items'])})
        except Exception as error: errors.append({'id':quote['id'],'source':path,'error':str(error)})
    Path(args.output).write_text(json.dumps({'quotes':recovered,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'recovered':len(recovered),'lines':sum(len(q['content']['items']) for q in recovered),'errors':errors},ensure_ascii=False))
    if errors: raise SystemExit(1)

if __name__=='__main__': main()
