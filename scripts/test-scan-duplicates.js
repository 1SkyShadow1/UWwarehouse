const test=require('node:test');
const assert=require('node:assert/strict');
const {matches,cleanupCandidates}=require('../public/js/scan-duplicates');
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
test('cleanup keeps an original and protects approved scans even across overlapping AI groups',()=>{
  const records=[{...original,id:'a'},{...original,id:'b',reviewStatus:'Approved'}, {...original,id:'c'}];
  const candidates=cleanupCandidates(records,[{ids:['a','b'],reason:'same receipt'},{ids:['a','c'],reason:'same receipt'}]);
  assert.deepEqual(candidates.map(candidate=>candidate.id),['a','c']);
  assert(candidates.every(candidate=>candidate.keepId==='b'));
  assert.equal(cleanupCandidates([{...original,id:'a'},{...original,id:'b',merchant:'Other',invoiceNumber:''}]).length,0);
});
test('three copies of the same receipt keep one original; reused receipt numbers and contradictory AI groups do not remove different transactions',()=>{
  const copies=['original','photo','rescan'].map(id=>({...original,id,name:id+'.jpg'}));
  const candidates=cleanupCandidates(copies);
  assert.equal(candidates.length,2);assert(candidates.every(row=>row.keepId==='original'));
  const different={...original,id:'different',scanDate:'2026-10-08',amount:200};
  assert.equal(matches(different,[original]).length,0);
  assert.equal(cleanupCandidates([original,different],[{ids:['original','different'],reason:'AI suggestion'}]).length,0);
  assert.equal(matches({...original,id:'another-purchase',invoiceNumber:'INV-002'},[original]).length,0,'Distinct receipt numbers at the same shop/date/amount are separate purchases');
});
