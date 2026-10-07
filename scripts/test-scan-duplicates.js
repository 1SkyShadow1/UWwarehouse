const test=require('node:test');
const assert=require('node:assert/strict');
const {matches}=require('../public/js/scan-duplicates');
const original={id:'original',name:'original.pdf',merchant:'Chamdor Fabrics',scanDate:'2026-10-07',amount:123.45,invoiceNumber:'INV-001'};
test('AI-extracted identity detects rescans with different filenames and hashes',()=>{
  const scan={id:'rescan',name:'new-photo.jpg',merchant:'CHAMDOR FABRICS',documentDate:'2026-10-07',amountPaid:123.45};
  assert.equal(matches(scan,[original])[0].id,'original');
  assert.match(matches({...scan,documentDate:null,invoiceNumber:'INV001'},[original])[0].reason,/number/);
});
test('same amount alone, missing amounts, different currencies and self are not duplicates',()=>{
  assert.equal(matches({...original,id:'new',merchant:'Another shop',invoiceNumber:''},[original]).length,0);
  assert.equal(matches({...original,id:'new',amount:null,invoiceNumber:''},[original]).length,0);
  assert.equal(matches(original,[original]).length,0);
  assert.equal(matches({...original,id:'new',invoiceNumber:'',currency:'USD'},[{...original,currency:'ZAR'}]).length,0);
});
test('identical bytes are detected independently of OCR quality',()=>{
  assert.equal(matches({id:'new',contentHash:'abc'},[{id:'old',hash:'abc',name:'old.jpg'}]).length,1);
});
