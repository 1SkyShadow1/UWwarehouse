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
  const type = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(res);
});

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: process.env.UW_TEST_BROWSER || 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await context.route('https://**', route => route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'load' });
    await page.evaluate(() => {
      save = () => { window.testSaves = (window.testSaves || 0) + 1; };
      document.getElementById('boot-screen').style.display = 'none';
      document.getElementById('login-screen').classList.add('hidden');
      document.body.classList.add('app-ready');
      DB.invoices = []; DB.quotes = []; DB.receipts = [];
    });
    await page.addStyleTag({content:'#boot-screen,#login-screen{display:none!important}'});
    const catalog = await page.evaluate(() => window.UW_FABRIC_CATALOG);
    assert.equal(catalog.fabrics.length, 1421);
    await page.evaluate(() => newInvoice());
    const representatives = Object.keys(catalog.sources).map(key => catalog.fabrics.find(f => f.sourceId === key && !f.needsPriceConfirmation));
    for (let index = 0; index < representatives.length; index++) {
      if (index) await page.evaluate(() => addItemRow());
      const row = page.locator('#f-items tr').nth(index + 1);
      const label = await page.evaluate(id => fabricLookupLabel(findFabric(id)), representatives[index].id);
      await row.locator('.line-fabric').fill(label);
      await row.locator('.line-fabric').dispatchEvent('change');
      const expected = await page.evaluate(id => fabricDefaultPrice(findFabric(id)).amount, representatives[index].id);
      assert.equal(Number(await row.locator('.i-price').inputValue()), expected);
      await row.locator('.i-qty').fill('2.5');
      if(representatives[index].unitUnspecified)await row.locator('.line-fabric-unit').selectOption('m');
    }
    await page.locator('#f-cust').fill('Fabric browser test');
    await page.evaluate(() => saveInvoice());
    const invoice = await page.evaluate(() => DB.invoices[0]);
    assert.equal(invoice.items.length, 6);
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

    const gazelles = catalog.fabrics.filter(f => f.sourceId === 'gameskin' && f.desc === 'GAZELLE');
    assert.equal(gazelles.length, 2);
    await page.evaluate(() => newQuote());
    for (let i = 0; i < 2; i++) {
      if (i) await page.evaluate(() => addItemRow());
      const row = page.locator('#f-items tr').nth(i + 1);
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
    const renamedId=await page.evaluate(()=>nextInvoiceNo(document.getElementById('ef-date').value,'EE'));
    await page.locator('#ef-no').fill(renamedId);
    await page.evaluate(id=>saveEditedInvoice(id),convertedId);
    assert.equal(await page.evaluate(()=>DB.jobs[0].invoiceId),renamedId);
    assert.equal(await page.evaluate(()=>DB.receipts[0].invoiceId),renamedId);
    assert.equal(await page.evaluate(()=>DB.quotes[0].invoiceId),renamedId);
    await page.evaluate(id=>editQuote(id),quote.id);
    await page.locator('#eq-no').fill('RENAMED-QUOTE-TEST');
    await page.evaluate(id=>saveEditedQuote(id),quote.id);
    assert.equal(await page.evaluate(()=>DB.invoices[0].generatedFromQuote),'RENAMED-QUOTE-TEST');
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
    await page.locator('.line-fabric').fill(await page.evaluate(id => fabricLookupLabel(findFabric(id)), helm.id));
    await page.locator('.line-fabric').dispatchEvent('change');
    await page.locator('.line-fabric-vat').selectOption('incl');
    assert.equal(Number(await page.locator('.i-price').inputValue()), 117.3);
    await page.locator('.line-fabric').fill('not a supplier fabric');
    await page.locator('.line-fabric').dispatchEvent('change');
    assert.equal(await page.evaluate(() => collectDocumentItems('f-items', 'i')), null);
    const zero = catalog.fabrics.find(f => f.needsPriceConfirmation);
    await page.locator('.line-fabric').fill(await page.evaluate(id => fabricLookupLabel(findFabric(id)), zero.id));
    await page.locator('.line-fabric').dispatchEvent('change');
    assert.equal(await page.locator('.i-price').inputValue(), '');
    assert.equal(await page.evaluate(() => collectDocumentItems('f-items', 'i')), null);
    await page.locator('.i-price').fill('123.45');
    assert.equal((await page.evaluate(() => collectDocumentItems('f-items', 'i')))[0].price, 123.45);
    await page.evaluate(() => closeModal());

    // Catalog is read from its bundle even after a restored DB has no fabrics.
    await page.evaluate(() => { window.savedTestFabrics = DB.fabrics; DB.fabrics = []; go('fabrics'); });
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
    assert.equal(calcQuote.items[0].price, 102);
    assert(Math.abs(calcQuote.items.reduce((s, i) => s + i.qty * i.price, 0) - calcQuote.calculator.total) < 0.000001);

    await page.evaluate(() => { go('pricing'); const before = document.getElementById('pc-fab').value; document.getElementById('pc-item').value = '1'; loadPricePreset(); window.presetChanged = before !== document.getElementById('pc-fab').value || Number(document.getElementById('pc-mtr').value) === Number(DB.priceBook[1].mtr); });
    assert.equal(await page.evaluate(() => window.presetChanged), true);
    await page.evaluate(() => newInvoice());
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
    await page.locator('.line-fabric').fill(await page.evaluate(id=>fabricLookupLabel(findFabric(id)),bulk.id));
    await page.locator('.line-fabric').dispatchEvent('change');
    await page.locator('.line-fabric-price').selectOption('bulk-200m');
    await page.locator('.i-qty').fill('200');
    assert.equal(await page.evaluate(()=>collectDocumentItems('f-items','i')),null);
    await page.locator('.i-qty').fill('201');
    assert.equal((await page.evaluate(()=>collectDocumentItems('f-items','i')))[0].price,57);
    const leather=catalog.fabrics.find(f=>f.sourceId==='mill'&&f.desc==='LEATHER AGAVE');
    await page.locator('.line-fabric').fill(await page.evaluate(id=>fabricLookupLabel(findFabric(id)),leather.id));
    await page.locator('.line-fabric').dispatchEvent('change');
    assert.equal((await page.evaluate(()=>collectDocumentItems('f-items','i')))[0].unit,'m²');
    assert.equal(Number(await page.locator('.i-price').inputValue()),583);
    const panel=catalog.fabrics.find(f=>f.sourceId==='mill'&&f.desc==='MADAME');
    await page.locator('.line-fabric').fill(await page.evaluate(id=>fabricLookupLabel(findFabric(id)),panel.id));
    await page.locator('.line-fabric').dispatchEvent('change');
    assert.equal((await page.evaluate(()=>collectDocumentItems('f-items','i')))[0].unit,'panel');
    assert.equal(Number(await page.locator('.i-price').inputValue()),750);
    assert.deepEqual(errors, []);
    if (process.env.UW_TEST_SCREENSHOT){
      await page.evaluate(()=>{closeModal();newQuote();});
      await page.locator('#f-cust').fill('Sample client');
      await page.locator('.line-fabric').fill(await page.evaluate(id=>fabricLookupLabel(findFabric(id)),helm.id));
      await page.locator('.line-fabric').dispatchEvent('change');
      await page.locator('.i-qty').fill('2.5');
      await page.locator('.i-qty').dispatchEvent('input');
      await page.screenshot({ path: process.env.UW_TEST_SCREENSHOT, fullPage: true });
      await page.evaluate(()=>{closeModal();go('fabrics');setDocFilter('fabrics','q','');setDocFilter('fabrics','category','The Mill');applyDocFilter('fabrics');});
      await page.screenshot({path:process.env.UW_TEST_SCREENSHOT.replace(/\.png$/,'.catalog.png'),fullPage:true});
    }
    console.log('PASS: six suppliers, autofill, fractional quantities, invoice/quote edits, overrides, VAT, confirmed supplier units, hide units, duplicate designs, quote conversion, linked record renaming, duplicate document IDs, missing prices, unknown selections, bulk eligibility, catalog search/restore, calculator reconciliation and preset refresh; no browser exceptions.');
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
