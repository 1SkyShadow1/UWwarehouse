// Source repairs replace placeholders only. User edits and historical identifiers survive.
(function(root){
  const placeholder=value=>/^Imported(?:\s+quote|\s+from\b|$)/i.test(String(value||'').trim());
  function recoverImportedQuotes(data,sources=[]){
    const byId=new Map(sources.map(quote=>[quote.id,quote]));let changed=0;
    for(const quote of data.quotes||[]){
      const source=byId.get(quote.id);if(!source?.sourceContentVersion||quote.sourceContentVersion===source.sourceContentVersion)continue;
      let repaired=false;
      for(const key of ['customer','contact','phone','email','billingAddress','expiry','preparedBy','projectReference','introduction','notes']){
        if((!quote[key]||placeholder(quote[key]))&&source[key]!==undefined&&quote[key]!==source[key]){quote[key]=source[key];repaired=true;}
      }
      if(quote.items?.length&&quote.items.every(line=>placeholder(line.desc))){quote.items=JSON.parse(JSON.stringify(source.items));repaired=true;}
      if(quote.status==='Imported'){quote.status='Draft';repaired=true;}
      if(repaired){
        quote.sourceWorkbook=source.sourceWorkbook;quote.sourceContentVersion=source.sourceContentVersion;
        quote.sourcePricingWarnings=[...(source.sourcePricingWarnings||[])];changed++;
      }
    }
    return changed;
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={recoverImportedQuotes};else root.recoverImportedQuotes=recoverImportedQuotes;
})(typeof globalThis!=='undefined'?globalThis:this);
