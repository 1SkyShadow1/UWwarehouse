// Both document types use DDMMYY; their daily sequences remain independent.
function documentDateKey(date=today()){
  const value=String(date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||dateAfterDays(value,0)!==value)return '';
  return value.slice(8,10)+value.slice(5,7)+value.slice(2,4);
}
function nextDocumentNo(collection,date=today(),prefix='BB'){
  const initials=/^(BB|SS)$/.test(prefix)?prefix:'BB',key=documentDateKey(date);
  if(!key)return '';
  const pattern=new RegExp('^'+initials+key+'(\\d{2,})$');
  const sequences=(DB[collection]||[]).map(record=>String(record.id||'').match(pattern)).filter(Boolean).map(match=>Number(match[1]));
  return initials+key+String(Math.max(0,...sequences)+1).padStart(2,'0');
}
function nextInvoiceNo(date=today(),prefix='BB'){return nextDocumentNo('invoices',date,prefix);}
function nextQuoteNo(date=today(),prefix='BB'){return nextDocumentNo('quotes',date,prefix);}
function validDocumentNo(id,date){const key=documentDateKey(date);return /^(BB|SS)\d{6}\d{2,}$/.test(String(id||''))&&key!==''&&String(id).slice(2,8)===key&&Number(String(id).slice(8))>0;}
function validInvoiceNo(id,date){return validDocumentNo(id,date);}
function validQuoteNo(id,date){return validDocumentNo(id,date);}
