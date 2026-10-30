// Shared by browser previews and server PDFs. Never merges financial line items.
(function(root){
  function documentVatNote(record={},meta={}){
    const note=typeof record.vatNote==='string'?record.vatNote.trim():'';
    return note||(typeof meta.vatNote==='string'?meta.vatNote.trim():'')||'*Quoted prices above exclude VAT.';
  }
  function documentLineDescription(line={},options={}){
    let description=String(line.desc||'').trim();
    const selected=String(line.item||'').trim();
    const category=/^(Fabric|Foam|Labour|Consumables|Delivery)$/i.test(selected)?selected:(line.fabricId?'Fabric':'');
    if(!category)return description;
    const escaped=category.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const categoryStart=new RegExp('^.*?\\s[-–—]\\s(?='+escaped+'\\b)','i');
    if(!(options.preserveProductPrefix&&line.quoteProductPrefix))description=description.replace(categoryStart,'');
    const repeated=new RegExp('^(?:'+escaped+'\\s*[-–—:]\\s*)+','i');
    const body=description.replace(repeated,'').trim();
    const contains=new RegExp('\\b'+escaped+'\\b','i').test(body);
    return contains?body:category+(body?' - '+body:'');
  }
  function documentLineProductPrefix(line={}){
    const description=String(line.desc||'').trim();
    const selected=String(line.item||'').trim();
    const category=/^(Fabric|Foam|Labour|Consumables|Delivery)$/i.test(selected)?selected:(line.fabricId?'Fabric':'');
    if(!category)return '';
    const escaped=category.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return description.match(new RegExp('^(.+?)\\s[-–—]\\s(?='+escaped+'\\b)','i'))?.[1]?.trim()||'';
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={documentLineDescription,documentLineProductPrefix,documentVatNote};
  else {root.documentLineDescription=documentLineDescription;root.documentLineProductPrefix=documentLineProductPrefix;root.documentVatNote=documentVatNote;}
})(typeof globalThis!=='undefined'?globalThis:this);
