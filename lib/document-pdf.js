const fs=require('node:fs');
const path=require('node:path');
const {documentLineDescription}=require('../public/js/document-format');

// One renderer for all exported invoice/quote PDFs, using the supplied templates.
function documentRenderer(PDFDocument,publicDir){
  return ({kind,record,meta={}})=>new Promise((resolve,reject)=>{
    const quote=kind==='quote',left=32,width=quote?531:515,right=left+width;
    const pdf=new PDFDocument({size:quote?'A4':'LETTER',margins:{top:28,bottom:28,left,right:32},info:{Title:`${quote?'Quotation':'Invoice'} ${record.id||''}`,Author:'Upholstery Warehouse'}});
    const chunks=[];pdf.on('data',c=>chunks.push(c));pdf.on('end',()=>resolve(Buffer.concat(chunks)));pdf.on('error',reject);
    const text=v=>String(v??'').replace(/\r/g,'');
    const money=v=>'R '+Number(v||0).toLocaleString('en-ZA',{minimumFractionDigits:2,maximumFractionDigits:2});
    const bottom=quote?810:760;let y=28;
    function ensure(height){if(y+height>bottom){pdf.addPage();y=28;return true;}return false;}
    function paragraph(value,size=9,bold=false){
      pdf.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size);
      // PDFKit flows very long notes across pages; preserve all supplied text.
      ensure(Math.min(pdf.heightOfString(text(value),{width,lineGap:2}),bottom-28));
      pdf.text(text(value),left,y,{width,lineGap:2});y=pdf.y+5;
    }
    function fields(a,b){
      pdf.font('Helvetica').fontSize(9);
      const half=(width-18)/2,h=Math.max(14,pdf.heightOfString(a,{width:half}),pdf.heightOfString(b,{width:half}))+4;
      ensure(h);pdf.text(a,left,y,{width:half}).text(b,left+half+18,y,{width:half});y+=h;
    }
    function rule(){pdf.moveTo(left,y).lineTo(right,y).strokeColor('#111').lineWidth(.5).stroke();}
    const logo=path.join(publicDir,'uw-document-logo.png');
    if(fs.existsSync(logo))pdf.image(logo,left,y,{width:quote?337:width});
    if(quote){
      pdf.font('Helvetica-Bold').fontSize(9).text('Upholstery Warehouse (Pty) Ltd',left+355,y,{width:176});
      pdf.font('Helvetica').fontSize(8).text(`${text(meta.phone||'077 412 8367')}\n${text(meta.address||'4, 5th Avenue, Edenvale, Johannesburg.')}\n${text(meta.email||'info@upholsterywarehouse.co.za')}`,left+355,y+16,{width:176});
      y+=88;pdf.font('Helvetica-Bold').fontSize(22).text('QUOTATION',left,y,{width,align:'center',underline:true});y+=35;
      fields(`Client account name: ${text(record.customer)}`,`Quote number: ${text(record.id)} · Revision ${record.revision||1}`);
      fields(`Client contact name: ${text(record.contact)}`,`Date generated: ${text(record.date)}`);
      fields(`Client telephone: ${text(record.phone)}`,`Expiry date: ${text(record.expiry)}`);
      fields(`Client email: ${text(record.email)}`,`Prepared by: ${text(record.preparedBy||'Brian Raymond')}`);
      fields(`Billing address: ${text(record.billingAddress)}`,`Contact mobile: ${text(meta.phone||'077 412 8367')}\nContact email: ${text(meta.email||'info@upholsterywarehouse.co.za')}`);
      paragraph(`Project Reference: ${text(record.projectReference)}`,9,true);
      paragraph('Introduction, notes and specifications',10,true);paragraph(record.introduction||record.notes||'',9);
      paragraph('Quote line items',10,true);
    }else{
      y+=118;pdf.font('Helvetica-Bold').fontSize(24).text('INVOICE',left,y);
      pdf.font('Helvetica-Bold').fontSize(9).text(`INVOICE NO: ${text(record.id)}\nDATE: ${text(record.date)}`,right-160,y,{width:160,align:'right'});y+=40;
      paragraph(`Upholstery Warehouse (Pty) Ltd\n${text(meta.address||'4, 5th Avenue, Edenvale, JHB, 1609.')}\n${text(meta.phone||'077 412 8367')} / ${text(meta.email||'info@upholsterywarehouse.co.za')}`);
      fields(`INVOICE TO: ${text(record.customer)}`,`Client Contact: ${text(record.contact)}`);
      fields(`Contact: ${text(record.phone)}`,`Order NO: ${text(record.orderNo)}`);
      fields(`VAT NO: ${text(record.vatNo)}`,`Project: ${text(record.project||'Re-Upholstery')}`);
      if(record.billingAddress)paragraph(`Billing address: ${text(record.billingAddress)}`);
      y+=8;
    }
    const widths=quote?[width*.45,width*.08,width*.2,width*.27]:[width*.2,width*.58,width*.22];
    function cells(values,bold=false){
      pdf.font(bold?'Helvetica-Bold':'Helvetica').fontSize(9);
      const h=Math.max(18,...values.map((v,i)=>pdf.heightOfString(text(v),{width:widths[i]-12})+6));
      let x=left;values.forEach((v,i)=>{
        if(quote)pdf.rect(x,y,widths[i],h).strokeColor('#111').lineWidth(.5).stroke();
        pdf.text(text(v),x+6,y+4,{width:widths[i]-12,align:i===0||(!quote&&i===1)?'left':'right'});x+=widths[i];
      });y+=h;if(!quote)rule();
    }
    const headings=quote?['Description','Qty','Unit Price','Total Price']:['ITEM CODE','DESCRIPTION','AMOUNT'];
    function continued(){pdf.addPage();y=28;paragraph(`${quote?'Quotation':'Invoice'} ${text(record.id)} — continued`,9,true);cells(headings,true);pdf.font('Helvetica').fontSize(9);}
    function fittingText(value,column,height){
      const valueText=text(value),options={width:widths[column]-12};
      if(pdf.heightOfString(valueText,options)<=height)return [valueText,''];
      let low=0,high=valueText.length;
      while(low<high){const middle=Math.ceil((low+high)/2);if(pdf.heightOfString(valueText.slice(0,middle),options)<=height)low=middle;else high=middle-1;}
      // Prefer a word boundary without dropping any content.
      const space=valueText.lastIndexOf(' ',low);if(space>low/2)low=space;
      return [valueText.slice(0,low),valueText.slice(low).trimStart()];
    }
    ensure(25);cells(headings,true);
    const items=Array.isArray(record.items)?record.items:[];
    for(const item of items){
      const description=documentLineDescription(item),quantity=Number(item.qty)||0;
      const values=quote?[description,String(quantity),money(item.price),money(quantity*Number(item.price||0))]:[text(item.code),description+(quantity!==1?` (${quantity} × ${money(item.price)})`:''),money(quantity*Number(item.price||0))];
      pdf.font('Helvetica').fontSize(9);
      const h=Math.max(18,...values.map((v,i)=>pdf.heightOfString(text(v),{width:widths[i]-12})+6));
      if(y+h>bottom)continued();
      if(h<=bottom-y){cells(values);continue;}
      // Split exceptionally long cells across pages. Quantities and amounts appear
      // once, on the last fragment; no duplicate financial lines are created.
      let remaining=values.map(text);
      while(remaining.some(Boolean)){
        const fragments=remaining.map((v,i)=>fittingText(v,i,bottom-y-8));
        const hasMore=fragments.some(([,rest])=>rest);
        const visible=fragments.map(([part],i)=>hasMore&&i>=(quote?1:2)?'':part);
        remaining=fragments.map(([part,rest],i)=>hasMore&&i>=(quote?1:2)?remaining[i]:rest);
        cells(visible);if(hasMore)continued();
      }
    }
    const total=items.reduce((s,i)=>s+(Number(i.qty)||0)*(Number(i.price)||0),0);
    ensure(28);y+=6;pdf.font('Helvetica-Bold').fontSize(11).text(`${quote?'*TOTAL':'*Grand Total:'}   ${money(total)}`,left,y,{width,align:'right'});y=pdf.y+10;
    if(quote){
      paragraph('Acceptance of quotation and official order',10,true);
      paragraph('By my signature I hereby declare that I have read, understood, and accept the above quotation and below terms.\n• 80% Deposit due on collection, 20% balance due prior to delivery.\n• No works will commence until deposit payment is made in full.\n• Unpaid balances will result in interest being charged as well as storage costs.\n• Quote includes FREE collection and delivery within a 10km radius of our workshop.\n'+(record.expiry?`• Quote is valid until ${text(record.expiry)}.`:'• Quote validity must be confirmed before acceptance.'),8);
      paragraph('Payment Details: COD or EFT',10,true);
      paragraph(`Upholstery Warehouse (PTY) LTD, ${text(meta.bank||'First National Bank')}, Account Number: ${text(meta.account||'63173509557')} - Branch Code: ${text(meta.branch||'250655')}\nKindly use ${text(record.id)} as reference when making payment. ${text(meta.vatNote||'*Quoted prices above exclude VAT.')} To be Invoiced.`,8);
      ensure(56);y+=8;fields('Client name: ........................................','Date: ........................................');y+=8;fields('Signature: ........................................','Place: ........................................');
    }else{
      paragraph(`${text(meta.vatNote||'*Quoted prices above exclude VAT.')}\nFull Terms and Conditions can be provided.\nAll goods received/collected in terms of this order remain the property of Upholstery Warehouse Pty Ltd until account is settled in full.\n\nBanking Details:\nAccount Name: Upholstery Warehouse (Pty) Ltd\nBank Name: ${text(meta.bank||'First National Bank')}\nAccount type: Current\nAccount Number: ${text(meta.account||'63173509557')}\nBranch Code: ${text(meta.branch||'250655')}\n\n*Kindly use ${text(record.id)} as reference when making payment.`,8);
      ensure(56);y+=8;fields('Received By: ........................................','Signature: ........................................');y+=8;fields('Date: ........................................','E&OE. Produced by UW');
    }
    pdf.end();
  });
}
module.exports={documentRenderer};
