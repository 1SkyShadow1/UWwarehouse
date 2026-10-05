const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..', 'public');
const context = vm.createContext({ window: {}, seed: { fabrics: [] }, DB: { fabrics: [] } });
vm.runInContext(fs.readFileSync(path.join(root, 'operations-data.js'), 'utf8'), context);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
  if (script[1].trim()) new vm.Script(script[1]);
}
vm.runInContext(html.slice(html.indexOf('/* ---------- FABRICS ---------- */'), html.indexOf('/* ---------- WAGES ---------- */')), context);
vm.runInContext(html.slice(html.indexOf('function priceCalc('), html.indexOf('function loadPricePreset(')), context);
const catalog = context.window.UW_FABRIC_CATALOG;

test('catalog covers all supplied suppliers with unique selectable identities', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(catalog.counts)), { gameskin: 14, helm: 69, hertex: 711, sullies: 205, mill: 143, loomcraft: 279 });
  assert.equal(catalog.fabrics.length, 1421);
  assert.equal(new Set(catalog.fabrics.map(f => f.id)).size, 1421);
  assert.equal(new Set(catalog.fabrics.map(context.fabricLookupLabel)).size, 1421);
  for (const f of catalog.fabrics) {
    assert(catalog.sources[f.sourceId].sha256.match(/^[a-f0-9]{64}$/));
    assert.equal(f.supplier, catalog.sources[f.sourceId].supplier);
    assert(f.page >= 1 && f.desc && Object.keys(f.fields).length);
    assert.equal(new Set(f.prices.map(p => p.key)).size, f.prices.length);
    assert(f.prices.some(p => Number.isFinite(p.amount)));
    for (const p of f.prices) {
      assert(p.amount === null || (Number.isFinite(p.amount) && p.amount >= 0));
      assert(['incl', 'excl'].includes(p.vat));
      assert(['m', 'm²', 'side/hide', 'sample', 'unit', 'panel'].includes(p.unit));
    }
  }
});

test('source amounts match preserved supplier fields and quoted tax columns', () => {
  const number = s => {const text=String(s).replace(/[R\s,]/g, '');return /^\d+(\.\d+)?$/.test(text)?Number(text):null;};
  for (const f of catalog.fabrics) {
    const prices = Object.fromEntries(f.prices.map(p => [p.key, p]));
    if (f.sourceId === 'hertex') assert.equal(prices.retail.amount, number(f.fields['RECOMMENDED RETAIL PRICE (INCL VAT)']));
    if (f.sourceId === 'gameskin') {
      assert.equal(prices.area.amount, f.fields['PRICE/M2 EX VAT']);
      assert.equal(prices.hide.amount, f.fields['APPROX. PRICE PER SIDE/HIDE (INCL VAT)']);
      assert.equal(prices.area.unit, 'm²');
      assert.equal(prices.hide.approximate, true);
    }
    if (f.sourceId === 'mill') {
      if(prices.roll||prices.area)assert.equal((prices.roll||prices.area).amount, number(f.fields['TRADE ROLL PRICE *EX VAT']));
      if(prices.cut)assert.equal(prices.cut.amount, number(f.fields['TRADE CUT PRICE *EX VAT']));
      if(prices.area)assert.equal(prices.area.unit, 'm²');
      if(prices.panel){assert.equal(prices.panel.amount,750);assert.equal(prices.panel.unit,'panel');}
    }
    if (f.sourceId === 'sullies') {
      assert.equal(prices.cash.amount, f.fields['Excl VAT']);
      assert.equal(prices.cash.amountIncl, f.fields['Incl VAT']);
      assert.equal(context.fabricRate(prices.cash, 'incl'), f.fields['Incl VAT']);
      assert.equal(f.unitUnspecified, true);
      assert.equal(f.needsPriceConfirmation, prices.cash.amount === 0);
    }
  }
  const loom = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'loomcraft-reviewed-cells.json'), 'utf8'));
  const imported = catalog.fabrics.filter(f => f.sourceId === 'loomcraft');
  assert.equal(imported.length, loom.rows.length);
  imported.forEach((f, i) => {
    assert.equal(f.prices.find(p => p.key === 'roll').amount, loom.rows[i].roll);
    assert.equal(f.prices.find(p => p.key === 'cut').amount, loom.rows[i].cut);
  });
});

test('VAT conversion, unavailable rates, zero rates and cut/roll defaults', () => {
  assert.equal(context.fabricRate({ amount: 102, vat: 'excl' }), 102);
  assert.equal(context.fabricRate({ amount: 102, vat: 'excl' }, 'incl'), 117.3);
  assert.equal(context.fabricRate({ amount: 440, vat: 'incl' }, 'excl'), 382.61);
  assert.equal(context.fabricRate({ amount: 0, vat: 'excl' }), 0);
  assert.equal(context.fabricRate({ amount: null, vat: 'excl' }), null);
  assert.equal(context.fabricRate({ amount: -1, vat: 'excl' }), null);
  assert.equal(context.fabricDefaultPrice(catalog.fabrics.find(f => f.sourceId === 'helm')).key, 'cut');
  assert.equal(context.fabricDefaultPrice(catalog.fabrics.find(f => f.sourceId === 'helm' && f.fields['Collection Name'] === 'Cloud')).key, 'roll');
});

test('leather variants, roll thresholds and embedded Mill specifications survive import', () => {
  const gazelles = catalog.fabrics.filter(f => f.sourceId === 'gameskin' && f.desc === 'GAZELLE');
  assert.equal(gazelles.length, 2);
  assert.notEqual(gazelles[0].id, gazelles[1].id);
  assert.notEqual(gazelles[0].colours, gazelles[1].colours);
  const bulk = catalog.fabrics.find(f => f.prices.some(p => p.minimumExclusive === 200));
  assert(bulk.prices.some(p => p.minimumExclusive === 1000 && p.amount === 54));
  const bold = catalog.fabrics.find(f => f.sourceId === 'mill' && f.desc === 'BOLD');
  assert(bold.fields['WOVEN IN SA'].includes('South African flag'));
  const borassus = catalog.fabrics.find(f => f.sourceId === 'mill' && f.desc === 'BORASSUS');
  assert(borassus.fields['CARE/FINISH'].includes('spillBLOCK'));
});

test('custom fabrics survive and imported legacy markup records do not duplicate the supplier list', () => {
  const old = { supplier: 'African Gameskin', code: 'OLD', desc: 'GAZELLE', cost: 375, markup: 100, sell: 750 };
  context.window.UW_IMPORTED = { fabrics: [old] };
  context.DB.fabrics = [old, { supplier: 'Custom supplier', code: 'OLD', desc: 'Custom', cost: 10, sell: 20 }];
  assert.equal(context.fabricCatalog().length, 1422);
  context.DB.fabrics[0] = { ...old, cost: 376 };
  assert.equal(context.fabricCatalog().length, 1423);
  assert.equal(context.fabricCatalog().find(f => f.supplier === 'Custom supplier').prices[0].amount, 10);
});

test('calculator uses fractional material measurement and independent quantities', () => {
  const r = context.priceCalc({}, 3, 102, 2.5, 1, 50, 1, 400, 2, 20, 12.34);
  assert.equal(r.fabT, 765);
  assert.equal(r.matT, 50);
  assert.equal(r.labT, 800);
  assert(Math.abs(r.sell - 1952.808) < 0.000001);
});
