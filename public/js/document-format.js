// Shared by browser previews and server PDFs. Never merges financial line items.
(function(root){
  function documentLineDescription(line={}){
    let description=String(line.desc||'').trim();
    const selected=String(line.item||'').trim();
    const category=/^(Fabric|Foam|Labour|Consumables|Delivery)$/i.test(selected)?selected:(line.fabricId?'Fabric':'');
    if(!category)return description;
    const escaped=category.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    // The product belongs in the project/introduction; category/detail belongs here.
    const categoryStart=new RegExp('^.*?\\s[-–—]\\s(?='+escaped+'\\b)','i');
    description=description.replace(categoryStart,'');
    const repeated=new RegExp('^(?:'+escaped+'\\s*[-–—:]\\s*)+','i');
    const body=description.replace(repeated,'').trim();
    const contains=new RegExp('\\b'+escaped+'\\b','i').test(body);
    return contains?body:category+(body?' - '+body:'');
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={documentLineDescription};
  else root.documentLineDescription=documentLineDescription;
})(typeof globalThis!=='undefined'?globalThis:this);
