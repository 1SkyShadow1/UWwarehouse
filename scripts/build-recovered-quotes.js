// Apply verified extraction to the existing historical bundle, leaving other collections intact.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const file=path.join(root,'public/imported-data.js');
const raw=fs.readFileSync(file,'utf8');
const data=JSON.parse(raw.slice(raw.indexOf('=')+1).trim().replace(/;$/,''));
const extraction=JSON.parse(fs.readFileSync(process.argv[2]||path.join(root,'tmp/quote-recovery.json'),'utf8'));
if(extraction.errors.length||extraction.quotes.length!==data.quotes.length)throw Error('Incomplete quote extraction');
const sources=new Map(extraction.quotes.map(quote=>[quote.id,quote]));
for(const quote of data.quotes){
  const source=sources.get(quote.id);if(!source)throw Error('Missing source '+quote.id);
  Object.assign(quote,source.content,{sourceWorkbook:source.sourceWorkbook,sourceContentVersion:'2026-10-07',status:quote.status==='Imported'?'Draft':quote.status});
}
// Preserve the original formatting of every unrelated collection.
const quoteStart=raw.indexOf('"quotes"');
const arrayStart=raw.indexOf('[',quoteStart);let depth=0,inString=false,escaped=false,arrayEnd=-1;
for(let index=arrayStart;index<raw.length;index++){
  const char=raw[index];
  if(inString){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')inString=false;continue;}
  if(char==='"'){inString=true;continue;}if(char==='[')depth++;if(char===']'&&--depth===0){arrayEnd=index+1;break;}
}
if(arrayEnd<0)throw Error('Historical quote collection is malformed');
fs.writeFileSync(file,raw.slice(0,arrayStart)+JSON.stringify(data.quotes,null,2)+raw.slice(arrayEnd));
console.log('Recovered',data.quotes.length,'quotes from verified workbooks.');
