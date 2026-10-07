(function(root){
  const text=value=>String(value||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g,'');
  const number=doc=>text(doc.invoiceNumber||doc.aiReview?.invoiceNumber);
  const merchant=doc=>text(doc.merchant||doc.vendor||doc.store||doc.business);
  const date=doc=>String(doc.documentDate||doc.scanDate||'');
  const amount=doc=>doc.amountPaid??doc.amount;
  function matches(document,documents){
    return (documents||[]).filter(other=>String(other.id)!==String(document.id)).flatMap(other=>{
      const hash=document.contentHash||document.hash,otherHash=other.contentHash||other.hash;
      const sameHash=hash&&otherHash===hash&&!/^(managed|local)-/.test(hash);
      const sameMerchant=merchant(document).length>2&&merchant(document)===merchant(other);
      const sameNumber=number(document)&&!['na','none','unknown'].includes(number(document))&&number(document)===number(other);
      const a=amount(document),b=amount(other);
      const sameAmount=a!=null&&b!=null&&String(a).trim()!==''&&String(b).trim()!==''&&Number(a)>0&&Math.abs(Number(a)-Number(b))<0.02;
      const sameDate=date(document)&&date(document)===date(other);
      const currency=value=>text(value)==='r'?'zar':text(value);
      const sameCurrency=!document.currency||!other.currency||currency(document.currency)===currency(other.currency);
      const reason=sameHash?'Identical file content':sameMerchant&&sameNumber?'Same merchant and receipt/invoice number':sameMerchant&&sameDate&&sameAmount&&sameCurrency?'Same merchant, document date and total':null;
      return reason?[{id:String(other.id),name:String(other.name||other.id),reason}]:[];
    });
  }
  function cleanupCandidates(documents,groups=[]){
    const ordered=[...(documents||[])].sort((a,b)=>Number(Boolean(b.includedInTotals||b.reviewStatus==='Approved'))-Number(Boolean(a.includedInTotals||a.reviewStatus==='Approved')));
    const removed=new Set(),candidates=[];
    for(let i=0;i<ordered.length;i++){
      const document=ordered[i];
      if(document.includedInTotals||document.reviewStatus==='Approved')continue;
      const earlier=ordered.slice(0,i).filter(doc=>!removed.has(String(doc.id)));
      const local=matches(document,earlier)[0];
      const aiGroup=groups.find(group=>group.ids.includes(String(document.id))&&earlier.some(doc=>group.ids.includes(String(doc.id))));
      const keeper=local?earlier.find(doc=>String(doc.id)===local.id):aiGroup?earlier.find(doc=>aiGroup.ids.includes(String(doc.id))):null;
      if(!keeper)continue;
      candidates.push({id:String(document.id),name:document.name,keepId:String(keeper.id),keepName:keeper.name,reason:local?.reason||aiGroup.reason||'Gemini identified a possible duplicate'});
      removed.add(String(document.id));
    }
    return candidates;
  }
  const api={matches,cleanupCandidates};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.UWScanDuplicates=api;
})(typeof window!=='undefined'?window:globalThis);
