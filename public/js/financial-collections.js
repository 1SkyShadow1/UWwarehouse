(function(root){
  const rows=value=>Array.isArray(value)?value:[];
  const number=value=>Number.isFinite(Number(value))?Number(value):0;
  const round=value=>Math.round((value+Number.EPSILON)*100)/100;
  const validDate=value=>{
    const date=String(value||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
    const parsed=new Date(date+'T12:00:00Z');
    return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;
  };
  function matchesPeriod(value,period,asOf){
    if(!period)return true;
    const date=String(value||'').slice(0,10);
    if(!validDate(date))return false;
    if(/^\d{4}-\d{2}$/.test(period))return date.slice(0,7)===period;
    if(/^year:\d{4}$/.test(period))return date.slice(0,4)===period.slice(5);
    if(/^ytd:\d{4}$/.test(period))return date>=period.slice(4)+'-01-01'&&date<=asOf&&date.slice(0,4)===period.slice(4);
    return false;
  }
  function unique(records){
    const seen=new Set();
    return rows(records).filter(record=>{
      const id=String(record?.id??'');
      if(!id||seen.has(id))return false;
      seen.add(id);return true;
    });
  }
  function summarize(db={},period='',asOf=new Date().toISOString().slice(0,10)){
    const invoices=unique(db.invoices),invoiceById=new Map(invoices.map(invoice=>[String(invoice.id),invoice]));
    const receipts=unique(db.receipts),receiptTotals=new Map(),undatedReceiptTotals=new Map();
    let receiptAmount=0,receiptCount=0,unlinkedReceiptAmount=0,unlinkedReceiptCount=0;
    for(const receipt of receipts){
      const amount=number(receipt.amount);
      if(amount<=0)continue;
      const appliedAmount=Math.max(0,number(receipt.invoiceAmount??receipt.amount));
      const invoiceId=String(receipt.invoiceId??''),invoice=invoiceById.get(invoiceId);
      if(!invoice){
        unlinkedReceiptAmount+=amount;unlinkedReceiptCount++;continue;
      }
      receiptTotals.set(invoiceId,(receiptTotals.get(invoiceId)||0)+appliedAmount);
      const date=String(receipt.date||'').slice(0,10);
      if(validDate(date)){
        if(matchesPeriod(date,period,asOf)){receiptAmount+=amount;receiptCount++;}
      }else if(!period){
        receiptAmount+=amount;receiptCount++;
      }else{
        undatedReceiptTotals.set(invoiceId,(undatedReceiptTotals.get(invoiceId)||0)+amount);
      }
    }
    let invoiceFallbackAmount=0,invoiceFallbackCount=0;
    for(const invoice of invoices){
      const invoiceId=String(invoice.id),recorded=Math.max(0,number(invoice.paid)+number(invoice.deposit));
      const legacy=Math.max(0,recorded-(receiptTotals.get(invoiceId)||0));
      const undated=period?(undatedReceiptTotals.get(invoiceId)||0):0;
      if(!period||matchesPeriod(invoice.date,period,asOf)){
        const fallback=legacy+undated;
        invoiceFallbackAmount+=fallback;
        if(fallback>0.005)invoiceFallbackCount++;
      }
    }
    const roundedReceipt=round(receiptAmount),roundedFallback=round(invoiceFallbackAmount);
    return {
      total:round(roundedReceipt+roundedFallback),
      receiptAmount:roundedReceipt,
      receiptCount,
      invoiceFallbackAmount:roundedFallback,
      invoiceFallbackCount,
      unlinkedReceiptAmount:round(unlinkedReceiptAmount),
      unlinkedReceiptCount,
    };
  }
  const api={summarize};
  root.UW_FINANCIAL_COLLECTIONS=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
