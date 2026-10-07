// Optional browser regression suite. Run with Playwright installed, or point
// UW_PLAYWRIGHT_MODULE at a supplied Playwright module. Uses a disposable browser
// and a read-only static HTTP server; application saves are intercepted in memory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.UW_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..', 'public');
const errors = [];
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end('{"error":"isolated browser test"}');
  }
  const file = path.resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); return res.end();
  }
  const type = { '.html': 'text/html', '.js': 'application/javascript', '.css':'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(res);
});

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: process.env.UW_TEST_BROWSER || 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await context.route('https://**', route => route.abort());
    if(process.env.UW_TEST_PRESET_CATALOG)await context.route(url=>url.pathname==='/item-presets.js',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(process.env.UW_TEST_PRESET_CATALOG,'utf8')}));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'load' });
    await page.evaluate(() => {
      save = () => { window.testSaves = (window.testSaves || 0) + 1; };
      document.getElementById('boot-screen').style.display = 'none';
      document.getElementById('login-screen').classList.add('hidden');
      document.body.classList.add('app-ready');
      DB.invoices = []; DB.quotes = []; DB.receipts = []; window.UW_OPERATOR={name:'Evans'};
    });
    await page.addStyleTag({content:'#boot-screen,#login-screen{display:none!important}'});
    await page.evaluate(()=>{DB.quotes=JSON.parse(JSON.stringify(window.UW_IMPORTED.quotes));});
    const recoveredPreview=await page.evaluate(()=>{
      let checked=0;
      for(const quote of DB.quotes){viewQuote(quote.id);const preview=document.getElementById('quote-preview');if(/Imported quote|Imported from/i.test(preview.innerText))throw Error('Placeholder remains '+quote.id);if(preview.querySelectorAll('tbody tr').length!==quote.items.length)throw Error('Missing source lines '+quote.id);checked++;}
      viewQuote('BB10062501');return {checked,text:document.getElementById('quote-preview').innerText};
    });
    assert.equal(recoveredPreview.checked,71);assert(recoveredPreview.text.includes('8 470')||recoveredPreview.text.includes('8 470'));assert(recoveredPreview.text.includes('Scatter Cushions'));
    await page.locator('#quote-preview').screenshot({path:path.join(root,'..','tmp/recovered-quote-preview.png')});
    await page.evaluate(()=>{viewQuote('MG27022401');});
    assert((await page.locator('#quote-preview').innerText()).includes('—'));
    await page.evaluate(()=>{DB.quotes=[];closeModal();newQuote();});
    await page.locator('#f-date').fill('2026-10-07');await page.locator('#f-date').dispatchEvent('change');
    assert.equal(await page.locator('#f-no').inputValue(),'BB26100701');
    await page.locator('#f-prefix').selectOption('SS');assert.equal(await page.locator('#f-no').inputValue(),'SS26100701');
    await page.locator('#f-date').fill('2026-10-08');await page.locator('#f-date').dispatchEvent('change');assert.equal(await page.locator('#f-no').inputValue(),'SS26100801');
    await page.evaluate(()=>closeModal());
    const catalog = await page.evaluate(() => window.UW_FABRIC_CATALOG);
    assert.equal(catalog.fabrics.length, 1421);
    // Category gating, historical consumable selection and custom colour persistence.
    await page.evaluate(()=>newQuote());
    const gated=page.locator('#f-items tr').nth(1);
    assert.equal(await gated.locator('.line-fabric').isVisible(),false);
    await gated.getByLabel('Item category').selectOption('Fabric');
    const gateFabric=catalog.fabrics.find(f=>f.sourceId==='helm'&&!f.needsPriceConfirmation);
    await gated.locator('.line-fabric').fill(await page.evaluate(id=>fabricLookupLabel(findFabric(id)),gateFabric.id));
    await gated.locator('.line-fabric').dispatchEvent('change');
    await gated.locator('.line-colour').fill('Custom Ocean Mist');
    assert.equal((await page.evaluate(()=>collectDocumentItems('f-items','i')))[0].colour,'Custom Ocean Mist');
    await gated.getByLabel('Item category').selectOption('Labour');
    assert.equal(await gated.locator('.line-fabric').isVisible(),false);
    assert.equal(await gated.locator('.line-fabric').isDisabled(),true);
    assert.equal(await gated.locator('.i-price').inputValue(),'');
    assert.equal(await page.evaluate(()=>document.querySelector('#f-items tr:nth-child(2)')._lineItem.fabricId),undefined);
    await gated.getByLabel('Item category').selectOption('Consumables');
    const glue=await page.evaluate(()=>archiveLinePresets('Consumables').find(p=>p.desc==='Consumables - Glue'&&p.price===143));
    await gated.locator('.line-preset-choice').selectOption(glue.id);
    assert.equal(await gated.locator('.i-desc').inputValue(),'Consumables - Glue');
    assert.equal(await gated.locator('.i-price').inputValue(),'143');
    assert.equal(await gated.locator('.line-cost').inputValue(),'');
    assert((await gated.locator('.line-profit').innerText()).includes('Historical source rate'));
    const beforeRefresh=await gated.locator('.i-desc').inputValue();
    await page.locator('#f-colour').fill('Terracotta');await page.locator('#f-colour').dispatchEvent('change');
    assert.equal(await gated.locator('.i-desc').inputValue(),beforeRefresh);
    await page.locator('#preset-type').selectOption('Complete item');
    await page.locator('#f-preset').selectOption('0');await page.getByRole('button',{name:'Add preset lines'}).click();
    assert.equal(await page.locator('#f-items tr').count(),5,'Existing consumable and three preset lines are retained');
    assert.equal(await gated.locator('.i-desc').inputValue(),'Consumables - Glue');
    assert.equal(await page.evaluate(()=>quotePresets().length),110+ (await page.evaluate(()=>archiveLinePresets().length+archiveJobPresets().length)));
    await page.setViewportSize({width:480,height:900});
    assert(await page.locator('#modal-root .modal').evaluate(el=>el.scrollWidth<=el.clientWidth+2),'Mobile editor should fit without horizontal overflow');
    const mobileBounds=await gated.evaluate(row=>{
      const selection=row.querySelector('.line-selection').getBoundingClientRect(),selling=row.querySelector('.line-selling').getBoundingClientRect();
      return {selectionBottom:selection.bottom,sellingTop:selling.top};
    });
    assert(mobileBounds.sellingTop>=mobileBounds.selectionBottom,'Mobile price fields should sit below material choices');
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(()=>closeModal());
    const historicalBundle=await page.evaluate(()=>archiveJobPresets()[0]);
    if(historicalBundle){
      await page.evaluate(()=>newQuote());
      await page.locator('#f-preset').selectOption('110');
      assert((await page.locator('#preset-preview').innerText()).includes('Keeps original job quantities'));
      assert((await page.locator('#f-qty').locator('..').innerText()).toLowerCase().includes('multiplier'));
      await page.locator('#f-qty').fill('2');
      await page.getByRole('button',{name:'Add preset lines'}).click();
      const lines=await page.evaluate(()=>collectDocumentItems('f-items','i'));
      assert.equal(lines.length,historicalBundle.lines.length);
      assert.equal(Math.round(lines.reduce((s,l)=>s+l.qty*l.price,0)*100)/100,2*historicalBundle.total);
      assert(!(await page.locator('#f-introduction').inputValue()).includes('source job'));
      await page.evaluate(()=>closeModal());
    }
    await page.evaluate(()=>go('suppliers'));
    assert((await page.locator('#content').innerText()).includes('1421 selectable source entries'));
    assert.equal(await page.getByRole('button',{name:'Browse fabrics',exact:true}).count(),6);
    await page.getByRole('button',{name:'Browse fabrics',exact:true}).first().click();
    assert.equal(await page.locator('#content table tr').count(),15);
    assert((await page.locator('#content').innerText()).includes('African Gameskin'));
    await page.evaluate(() => newInvoice());
    const representatives = Object.keys(catalog.sources).map(key => catalog.fabrics.find(f => f.sourceId === key && !f.needsPriceConfirmation));
    for (let index = 0; index < representatives.length; index++) {
      if (index) await page.evaluate(() => addItemRow());
      const row = page.locator('#f-items tr').nth(index + 1);
      const label = await page.evaluate(id => fabricLookupLabel(findFabric(id)), representatives[index].id);
      await row.locator('[aria-label="Item category"]').selectOption('Fabric');
      await row.locator('.line-fabric').fill(label);
      await row.locator('.line-fabric').dispatchEvent('change');
      const expected = await page.evaluate(id => fabricDefaultPrice(findFabric(id)).amount, representatives[index].id);
      assert.equal(Number(await row.locator('.i-price').inputValue()), expected);
      await row.locator('.i-qty').fill('2.5');
      if(representatives[index].unitUnspecified)await row.locator('.line-fabric-unit').selectOption('m');
    }
    await page.locator('#f-cust').fill('Fabric browser test');
    await page.locator('#f-order-no').fill('ORDER-QA');
    await page.locator('#f-vat-no').fill('VAT-QA');
    await page.evaluate(() => saveInvoice());
    const invoice = await page.evaluate(() => DB.invoices[0]);
    assert.equal(invoice.items.length, 6);
    assert.equal(invoice.orderNo,'ORDER-QA');assert.equal(invoice.vatNo,'VAT-QA');
    assert.equal(new Set(invoice.items.map(i => i.fabricId)).size, 6);
    assert(invoice.items.every(i => i.fabricSource && i.qty === 2.5));
    assert.equal(invoice.items.find(i=>i.fabricSource.supplier==='Sullies').unit,'m');

    await page.evaluate(id => editInvoice(id), invoice.id);
    assert.equal(Number(await page.locator('.ei-price').first().inputValue()), invoice.items[0].price);
    await page.locator('.ei-price').first().fill('321.09');
    await page.evaluate(id => saveEditedInvoice(id), invoice.id);
    assert.equal(await page.evaluate(() => DB.invoices[0].items[0].priceOverridden), true);
    await page.evaluate(id => editInvoice(id), invoice.id);
    assert.equal(Number(await page.locator('.ei-price').first().inputValue()), 321.09);
    await page.evaluate(() => closeModal());

    await page.evaluate(()=>newQuote());assert.equal(await page.locator('#f-prepared-by').inputValue(),'Evans');await page.evaluate(()=>closeModal());
    const gazelles = catalog.fabrics.filter(f => f.sourceId === 'gameskin' && f.desc === 'GAZELLE');
    assert.equal(gazelles.length, 2);
    await page.evaluate(() => newQuote());
    for (let i = 0; i < 2; i++) {
      if (i) await page.evaluate(() => addItemRow());
      const row = page.locator('#f-items tr').nth(i + 1);
      await row.locator('[aria-label="Item category"]').selectOption('Fabric');
      await row.locator('.line-fabric').fill(await page.evaluate(id => fabricLookupLabel(findFabric(id)), gazelles[i].id));
      await row.locator('.line-fabric').dispatchEvent('change');
    }
    assert.equal(Number(await page.locator('.i-price').nth(0).inputValue()), 375);
    assert.equal(Number(await page.locator('.i-price').nth(1).inputValue()), 345);
    await page.locator('.line-fabric-price').first().selectOption('hide');
    assert.equal(Number(await page.locator('.i-price').first().inputValue()), 1725);
    assert((await page.locator('.line-fabric-info').first().innerText()).includes('Approximate'));
    await page.locator('#f-cust').fill('Leather test');
    await page.evaluate(() => saveInvoice());
    const quote = await page.evaluate(() => DB.quotes[0]);
    await page.evaluate(id => editQuote(id), quote.id);
    assert.equal(Number(await page.locator('.eq-price').first().inputValue()), 1725);
    await page.evaluate(id => saveEditedQuote(id), quote.id);
    assert.equal(await page.evaluate(() => DB.quotes[0].items[0].unit), 'side/hide');
    await page.evaluate(id => convertQuote(id), quote.id);
    assert.deepEqual(await page.evaluate(() => DB.invoices[0].items), await page.evaluate(() => DB.quotes[0].items));
    const convertedId=await page.evaluate(()=>DB.invoices[0].id);
    await page.evaluate(id=>{DB.jobs=[{id:'test-job',invoiceId:id}];DB.receipts=[{id:'test-receipt',invoiceId:id,amount:0}];editInvoice(id);},convertedId);
    const renamedId=await page.evaluate(()=>nextInvoiceNo(document.getElementById('ef-date').value,'SS'));
    await page.locator('#ef-no').fill(renamedId);
    await page.evaluate(id=>saveEditedInvoice(id),convertedId);
    assert.equal(await page.evaluate(()=>DB.jobs[0].invoiceId),renamedId);
    assert.equal(await page.evaluate(()=>DB.receipts[0].invoiceId),renamedId);
    assert.equal(await page.evaluate(()=>DB.quotes[0].invoiceId),renamedId);
    await page.evaluate(id=>editQuote(id),quote.id);
    const renamedQuoteId=await page.evaluate(()=>nextQuoteNo(document.getElementById('eq-date').value,'SS'));
    await page.locator('#eq-no').fill(renamedQuoteId);
    await page.evaluate(id=>saveEditedQuote(id),quote.id);
    assert.equal(await page.evaluate(()=>DB.invoices[0].generatedFromQuote),renamedQuoteId);
    await page.evaluate(()=>newInvoice());
    await page.locator('#f-cust').fill('Duplicate check');
    await page.locator('.i-desc').fill('Work');
    await page.locator('#f-no').fill(invoice.id);
    const beforeDuplicate=await page.evaluate(()=>DB.invoices.length);
    await page.evaluate(()=>saveInvoice());
    assert.equal(await page.evaluate(()=>DB.invoices.length),beforeDuplicate);
    await page.evaluate(()=>closeModal());

    // Explicit VAT conversions, blocked unknown choices and blank supplier prices.
    const helm = catalog.fabrics.find(f => f.sourceId === 'helm');
    await page.evaluate(() => newInvoice());
    await page.locator('[aria-label="Item category"]').first().selectOption('Fabric');
    await page.locator('.line-fabric').fill(await page.evaluate(id => fabricLookupLabel(findFabric(id)), helm.id));
    await page.locator('.line-fabric').dispatchEvent('change');
    await page.locator('.line-fabric-vat').selectOption('incl');
    assert.equal(Number(await page.locator('.i-price').inputValue()), 117.3);
    await page.locator('[aria-label="Item category"]').first().selectOption('Fabric');
    await page.locator('.line-fabric').fill('not a supplier fabric');
    await page.locator('.line-fabric').dispatchEvent('change');
    assert.equal(await page.evaluate(() => collectDocumentItems('f-items', 'i')), null);
    const zero = catalog.fabrics.find(f => f.needsPriceConfirmation);
    await page.locator('[aria-label="Item category"]').first().selectOption('Fabric');
    await page.locator('.line-fabric').fill(await page.evaluate(id => fabricLookupLabel(findFabric(id)), zero.id));
    await page.locator('.line-fabric').dispatchEvent('change');
    assert.equal(await page.locator('.i-price').inputValue(), '');
    assert.equal(await page.evaluate(() => collectDocumentItems('f-items', 'i')), null);
    await page.locator('.i-price').fill('123.45');
    await page.locator('.line-cost').fill('100');
    assert.equal((await page.evaluate(() => collectDocumentItems('f-items', 'i')))[0].price, 123.45);
    await page.evaluate(() => closeModal());

    // Catalog is read from its bundle even after a restored DB has no fabrics.
    await page.evaluate(() => { window.savedTestFabrics = DB.fabrics; DB.fabrics = []; delete state.docFilters.fabrics; go('fabrics'); });
    assert.equal(await page.locator('#content table tr').count(), 1422);
    await page.evaluate(() => { setDocFilter('fabrics', 'q', 'Gazelle'); applyDocFilter('fabrics'); });
    assert.equal(await page.locator('#content table tr').count(), 3);
    await page.evaluate(() => { DB.fabrics = window.savedTestFabrics; go('pricing'); });
    await page.locator('#pc-fabric').fill(await page.evaluate(id => fabricLookupLabel(findFabric(id)), helm.id));
    await page.locator('#pc-fabric').dispatchEvent('change');
    assert.equal(Number(await page.locator('#pc-fab').inputValue()), 102);
    await page.locator('#pc-mtr').fill('2.5');
    await page.locator('#pc-fqty').fill('3');
    await page.locator('#pc-mat').fill('50');
    await page.locator('#pc-lhrs').fill('2');
    await page.locator('#pc-extra').fill('12.34');
    await page.evaluate(() => { calcPrice(); quoteFromCalc(); });
    const calcQuote = await page.evaluate(() => DB.quotes[0]);
    assert.equal(calcQuote.items[0].qty, 7.5);
    assert.equal(calcQuote.items[0].unitCost,102);
    assert.equal(calcQuote.items[0].price,122.4);
    assert.equal(Math.round(calcQuote.items.reduce((s, i) => s + i.qty * i.price, 0)*100)/100,calcQuote.calculator.total);
    assert(!calcQuote.items.some(item=>/pricing margin/i.test(item.desc)));

    await page.evaluate(() => { go('pricing'); const before = document.getElementById('pc-fab').value; document.getElementById('pc-item').value = '1'; loadPricePreset(); window.presetChanged = before !== document.getElementById('pc-fab').value || Number(document.getElementById('pc-mtr').value) === Number(DB.priceBook[1].mtr); });
    assert.equal(await page.evaluate(() => window.presetChanged), true);
    await page.evaluate(() => newInvoice());
    await page.locator('[aria-label="Item category"]').selectOption('Other');
    await page.locator('.i-qty').fill('0');
    await page.locator('.i-desc').fill('Deliberate zero quantity');
    assert.equal((await page.evaluate(() => collectDocumentItems('f-items', 'i')))[0].qty, 0);
    await page.locator('.i-price').fill('-1');
    assert.equal(await page.evaluate(() => collectDocumentItems('f-items', 'i')), null);
    await page.evaluate(()=>{closeModal();newQuote();document.getElementById('f-preset').value='0';applyQuotePreset('0');});
    await page.locator('.line-fabric').first().fill(await page.evaluate(id=>fabricLookupLabel(findFabric(id)),helm.id));
    await page.locator('.line-fabric').first().dispatchEvent('change');
    await page.locator('#f-qty').fill('3');
    await page.locator('#f-qty').dispatchEvent('change');
    assert.equal(Number(await page.locator('.i-price').first().inputValue()),102);
    assert.equal(await page.evaluate(()=>document.querySelector('#f-items tr:nth-child(2)')._lineItem.fabricId),helm.id);
    await page.evaluate(()=>{closeModal();newInvoice();});
    const bulk=catalog.fabrics.find(f=>f.prices.some(p=>p.minimumExclusive===200));
    await page.locator('[aria-label="Item category"]').first().selectOption('Fabric');
    await page.locator('.line-fabric').fill(await page.evaluate(id=>fabricLookupLabel(findFabric(id)),bulk.id));
    await page.locator('.line-fabric').dispatchEvent('change');
    await page.locator('.line-fabric-price').selectOption('bulk-200m');
    await page.locator('.i-qty').fill('200');
    assert.equal(await page.evaluate(()=>collectDocumentItems('f-items','i')),null);
    await page.locator('.i-qty').fill('201');
    assert.equal((await page.evaluate(()=>collectDocumentItems('f-items','i')))[0].price,57);
    const leather=catalog.fabrics.find(f=>f.sourceId==='mill'&&f.desc==='LEATHER AGAVE');
    await page.locator('[aria-label="Item category"]').first().selectOption('Fabric');
    await page.locator('.line-fabric').fill(await page.evaluate(id=>fabricLookupLabel(findFabric(id)),leather.id));
    await page.locator('.line-fabric').dispatchEvent('change');
    assert.equal((await page.evaluate(()=>collectDocumentItems('f-items','i')))[0].unit,'m²');
    assert.equal(Number(await page.locator('.i-price').inputValue()),583);
    const panel=catalog.fabrics.find(f=>f.sourceId==='mill'&&f.desc==='MADAME');
    await page.locator('[aria-label="Item category"]').first().selectOption('Fabric');
    await page.locator('.line-fabric').fill(await page.evaluate(id=>fabricLookupLabel(findFabric(id)),panel.id));
    await page.locator('.line-fabric').dispatchEvent('change');
    assert.equal((await page.evaluate(()=>collectDocumentItems('f-items','i')))[0].unit,'panel');
    assert.equal(Number(await page.locator('.i-price').inputValue()),750);
    // Visible picker selection, independent cost/selling prices, and accepted revisions.
    await page.evaluate(()=>{closeModal();newQuote();});
    await page.locator('[aria-label="Item category"]').first().selectOption('Fabric');
    await page.locator('#modal-root .fabric-supplier').selectOption('Helm');
    await page.locator('[aria-label="Item category"]').first().selectOption('Fabric');
    await page.locator('.line-fabric').fill(helm.desc);
    const searchResult=page.locator(`.fabric-result[data-fabric-id="${helm.id}"]`);
    assert((await searchResult.innerText()).includes('excl VAT'));
    await page.locator(`#modal-root .fabric-favorite[data-fabric-id="${helm.id}"]`).click();
    await page.locator('#modal-root .fabric-scope').selectOption('favorites');
    assert.equal(await page.locator('#modal-root .fabric-result').count(),1);
    await searchResult.click();
    assert.equal(await page.evaluate(id=>DB.meta.fabricPicker.recentIds[0]===id,helm.id),true);
    assert.equal(Number(await page.locator('.line-cost').inputValue()),102);
    await page.locator('.line-markup').fill('25');
    assert.equal(Number(await page.locator('.i-price').inputValue()),127.5);
    await page.locator('.i-qty').fill('2.5');
    assert((await page.locator('.line-profit').innerText()).includes('20.0%'));
    assert((await page.locator('#f-items-profit').innerText()).includes(await page.evaluate(()=>R(318.75))));
    await page.locator('.line-fabric-vat').selectOption('incl');
    assert.equal(Number(await page.locator('.line-cost').inputValue()),117.3);
    assert.equal(Number(await page.locator('.i-price').inputValue()),146.63);
    await page.locator('.line-fabric-vat').selectOption('listed');
    await page.locator('#f-cust').fill('Revision client');
    assert.equal(await page.locator('#f-expiry').inputValue(),await page.evaluate(()=>dateAfterDays(today())));
    await page.evaluate(()=>saveInvoice());
    const revisionQuote=await page.evaluate(()=>DB.quotes[0]);
    assert.equal(revisionQuote.revision,1);
    assert.equal(revisionQuote.items[0].unitCost,102);
    await page.evaluate(id=>{acceptQuote(id);viewQuote(id);},revisionQuote.id);
    const customerPreview=await page.locator('#quote-preview').innerText();
    assert(customerPreview.includes('Revision 1'));
    assert(customerPreview.includes('valid until '+revisionQuote.expiry));
    assert(!customerPreview.includes('Markup')&&!customerPreview.includes('Cost / unit'));
    await page.evaluate(id=>{closeModal();convertQuote(id);},revisionQuote.id);
    const acceptedInvoice=await page.evaluate(()=>DB.invoices[0]);
    assert.equal(acceptedInvoice.quoteRevision,1);
    await page.evaluate(id=>editQuote(id),revisionQuote.id);
    await page.locator('.eq-price').fill('150');
    await page.evaluate(id=>saveEditedQuote(id),revisionQuote.id);
    const revised=await page.evaluate(()=>DB.quotes.find(q=>q.customer==='Revision client'));
    assert.equal(revised.revision,2);assert.equal(revised.status,'Draft');
    assert.equal(revised.acceptedVersion.snapshot.items[0].price,127.5);
    assert.equal(await page.evaluate(id=>DB.invoices.find(i=>i.id===id).items[0].price,acceptedInvoice.id),127.5);
    await page.evaluate(id=>viewQuoteHistory(id),revisionQuote.id);
    assert((await page.locator('#modal-root').innerText()).includes('selling / unit: 127.5 → 150'));
    await page.evaluate(id=>viewQuoteRevision(id,1),revisionQuote.id);
    assert((await page.locator('#quote-preview').innerText()).includes('Revision 1'));
    await page.evaluate(id=>viewAcceptedQuote(id),revisionQuote.id);
    assert((await page.locator('#quote-preview').innerText()).includes('Revision 1'));
    await page.evaluate(()=>closeModal());
    await page.evaluate(id=>editQuote(id),revisionQuote.id);
    const revisionBefore=await page.evaluate(id=>DB.quotes.find(q=>q.id===id).revision,revisionQuote.id);
    await page.evaluate(id=>saveEditedQuote(id),revisionQuote.id);
    assert.equal(await page.evaluate(id=>DB.quotes.find(q=>q.id===id).revision,revisionQuote.id),revisionBefore);
    await page.evaluate(()=>newQuote());
    await page.locator('#f-cust').fill('Expired client');
    await page.locator('#f-date').fill('2026-01-01');
    await page.locator('#f-expiry').fill('2026-01-31');
    await page.locator('[aria-label="Item category"]').selectOption('Labour');
    await page.locator('.i-desc').fill('Expired work');
    await page.locator('.i-price').fill('50');
    await page.evaluate(()=>saveInvoice());
    const expiredQuote=await page.evaluate(()=>DB.quotes[0]);
    const invoiceCount=await page.evaluate(()=>DB.invoices.length);
    await page.evaluate(id=>convertQuote(id),expiredQuote.id);
    assert.equal(await page.evaluate(()=>DB.invoices.length),invoiceCount);
    assert.equal(await page.evaluate(id=>DB.quotes.find(q=>q.id===id).status,expiredQuote.id),'Draft');
    // Daily actions open the precise record and remain independent of month filters.
    await page.evaluate(({invoiceId,quoteId})=>{
      DB.invoices.find(i=>i.id===invoiceId).dueDate=dateAfterDays(today(),-1);
      DB.quotes.find(q=>q.id===quoteId).expiry=dateAfterDays(today(),3);
      DB.jobs=[{id:'daily-job',stage:'Deposit received',customer:'Daily client'}];
      DB.stock=[{sku:'daily-stock',name:'Daily fabric',quantity:1,reorderLevel:2,unit:'m'}];
      DB.fnbStatements=[{id:'daily-statement',transactions:[{id:'daily-bank',date:today(),description:'Daily purchase',debit:100,allocationNeedsReview:true}]}];
      state.mfilter='2020-01';go('dashboard');
    },{invoiceId:acceptedInvoice.id,quoteId:revisionQuote.id});
    assert((await page.locator('#content').innerText()).includes('Overdue invoice'));
    assert((await page.locator('#content').innerText()).includes('Job awaiting materials'));
    const dailyInvoiceRow=page.locator('#content tr').filter({hasText:acceptedInvoice.id}).first();
    await dailyInvoiceRow.getByRole('button',{name:'Open',exact:true}).click();
    assert((await page.locator('#invoice-preview').innerText()).includes(acceptedInvoice.id));
    await page.evaluate(()=>{closeModal();go('dashboard');});
    await page.getByLabel('Daily action category').selectOption('quote');
    assert(!(await page.locator('#content .panel').first().innerText()).includes('Low stock'));
    await page.evaluate(()=>openDailyAction('bank','daily-bank'));
    assert((await page.locator('#modal-root').innerText()).includes('Daily purchase'));
    await page.getByLabel('Bank action category').selectOption('Other');
    assert.equal(await page.evaluate(()=>DB.fnbStatements[0].transactions[0].allocationNeedsReview),false);
    await page.evaluate(()=>go('dashboard'));
    assert(!(await page.evaluate(()=>dailyActions(DB).map(a=>a.id))).includes('daily-bank'));
    // Printed material descriptions and contact fields follow the supplied templates.
    await page.evaluate(()=>{
      closeModal();DB.quotes.push({id:'TEMPLATE-QA',date:'2026-10-06',expiry:'2026-11-06',customer:'Template client',contact:'Client manager',phone:'011 555 0100',email:'client@example.com',billingAddress:'42 Client Road',projectReference:'Train seats',items:[{item:'Fabric',desc:'Fabric - Fabric - Prasa',qty:144,price:351},{item:'Foam',desc:'Foam - Foam - Yellow',qty:72,price:58.5}]});viewQuote('TEMPLATE-QA');
    });
    assert.deepEqual(await page.locator('#quote-preview thead th').allTextContents(),['Description','Qty','Unit Price','Total Price']);
    const printed=await page.locator('#quote-preview tbody').innerText();
    assert.equal((printed.match(/Fabric/g)||[]).length,1);assert.equal((printed.match(/Foam/g)||[]).length,1);
    assert((await page.locator('#quote-preview').innerText()).includes('42 Client Road'));
    assert.equal(await page.locator('#quote-preview .template-logo').getAttribute('src'),'uw-document-logo.png');
    await page.locator('#quote-preview .template-logo').evaluate(img=>img.decode());
    await page.locator('#quote-preview').screenshot({path:path.join(__dirname,'..','tmp','quote-browser-proof.png')});
    await page.emulateMedia({media:'print'});
    assert.equal(await page.locator('.doc-viewer').evaluate(el=>getComputedStyle(el).overflow),'visible');
    await page.pdf({path:path.join(__dirname,'..','tmp','quote-browser-print-proof.pdf'),printBackground:true,preferCSSPageSize:true});
    await page.emulateMedia({media:'screen'});
    await page.evaluate(()=>{closeModal();DB.receipts.push({id:'TEMPLATE-R',receiptNo:'TEMPLATE-R',invoiceId:'TEMPLATE-I',date:'2026-10-06',customer:'Template client',method:'EFT',amount:100});viewReceipt('TEMPLATE-R');});
    assert.equal(await page.locator('#print-area .template-logo').getAttribute('src'),'uw-document-logo.png');
    await page.locator('#print-area .template-logo').evaluate(img=>img.decode());
    await page.locator('#print-area').screenshot({path:path.join(__dirname,'..','tmp','receipt-browser-proof.png')});
    await page.emulateMedia({media:'print'});
    await page.pdf({path:path.join(__dirname,'..','tmp','receipt-browser-print-proof.pdf'),printBackground:true,preferCSSPageSize:true});
    await page.emulateMedia({media:'screen'});
    // Receipt upload, Gemini extraction, source preview and duplicate handling
    // run against an isolated in-memory workspace, never the live ledger.
    const scanId='a'.repeat(32);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
    let uploads=0,reviews=0;
    await context.route('**/api/documents',route=>{
      uploads++;return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({id:scanId,name:'receipt-test.png',url:'/api/documents/'+scanId})});
    });
    await context.route('**/api/documents/'+scanId,route=>route.fulfill({contentType:'image/png',body:png}));
    await context.route('**/api/ai/review-document',route=>{
      reviews++;return route.fulfill({contentType:'application/json',body:JSON.stringify({provider:'gemini',model:'fixture',documentDate:'2026-10-07',merchant:'Receipt test shop',amountPaid:123.45,currency:'ZAR',documentType:'receipt',confidence:0.99})});
    });
    await page.evaluate(async bytes=>{
      closeModal();DB.scannedDocuments=[];syncServerState=async()=>({serverSaved:true});
      const scan=new File([new Uint8Array(bytes)],'receipt-test.png',{type:'image/png'});
      await storeUploadedScan(scan);go('scanned');
    },Array.from(png));
    const uploaded=await page.evaluate(()=>DB.scannedDocuments[0]);
    assert.equal(uploaded.amount,123.45);assert.equal(uploaded.merchant,'Receipt test shop');
    assert.equal(uploaded.aiReview.provider,'gemini');assert.equal(uploaded.includedInTotals,false);
    assert.equal(uploads,1);assert.equal(reviews,1);
    await page.evaluate(()=>viewDocument(DB.scannedDocuments[0]));
    await page.locator('#document-image').waitFor({state:'visible'});
    await page.locator('#document-image').evaluate(img=>img.decode());
    await page.evaluate(async bytes=>{
      closeModal();await storeUploadedScan(new File([new Uint8Array(bytes)],'receipt-test.png',{type:'image/png'}));
    },Array.from(png));
    assert.equal(uploads,1);assert.equal(reviews,1);
    assert.equal(await page.evaluate(()=>DB.scannedDocuments.length),1);
    assert.deepEqual(errors, []);
    if (process.env.UW_TEST_SCREENSHOT){
      await page.evaluate(()=>{closeModal();newQuote();});
      await page.locator('#f-cust').fill('Sample client');
      await page.locator('[aria-label="Item category"]').first().selectOption('Fabric');
    await page.locator('.line-fabric').fill(await page.evaluate(id=>fabricLookupLabel(findFabric(id)),helm.id));
      await page.locator('.line-fabric').dispatchEvent('change');
      await page.locator('.i-qty').fill('2.5');
      await page.locator('.i-qty').dispatchEvent('input');
      await page.locator('#f-items tr').nth(1).screenshot({path:process.env.UW_TEST_SCREENSHOT.replace(/\.png$/,'.line.png')});
      await page.screenshot({ path: process.env.UW_TEST_SCREENSHOT, fullPage: true });
      await page.evaluate(()=>{closeModal();go('fabrics');setDocFilter('fabrics','q','');setDocFilter('fabrics','category','The Mill');applyDocFilter('fabrics');});
      await page.screenshot({path:process.env.UW_TEST_SCREENSHOT.replace(/\.png$/,'.catalog.png'),fullPage:true});
    }
    console.log('PASS: pricing, quote/invoice workflows, receipt upload/Gemini extraction/preview/duplicates, and calculator reconciliation; no browser exceptions.');
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
