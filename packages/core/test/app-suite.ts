import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyChanges, audit, breakdown, defaultState, DISCOUNTS_TEMPLATE, formatMoney, importCsv, InputError, loadStore,
  netRevenue, parseCsv, parseMoney, parsePercent, parsePromotion, PRODUCTS_TEMPLATE, queries, readStore, SAMPLE_SCENARIO,
  SAMPLE_STORE, suggestFixes, Workspace,
  type Discount, type Driver, type StoreInput,
} from '../src/index.ts';
import { createSlots } from '../src/slots.ts';

const NOW = Date.parse('2026-11-23T00:00:00Z');

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomStore(seed: number): StoreInput {
  const r = seeded(seed);
  const classes = ['product', 'order', 'shipping'] as const;
  const some = <T>(xs: readonly T[], p: number) => xs.filter(() => r() < p);
  const variants = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, i) => ({
    id: `v${i}`, title: `Item ${i}`, price: 2000 + Math.floor(r() * 9000), cost: 500 + Math.floor(r() * 5500),
    collections: r() < 0.5 ? ['c'] : [],
  }));
  const discounts = Array.from({ length: 2 + Math.floor(r() * 6) }, (_, i): Discount => {
    const cls = classes[Math.floor(r() * 3)];
    return {
      id: `d${i}`, title: `d${i}`, class: cls, method: r() < 0.5 ? 'code' : 'automatic',
      bps: cls === 'shipping' ? 0 : 500 + Math.floor(r() * 3000), off: 0, allVariants: r() < 0.6, variants: [],
      collections: ['c'], minSubtotal: r() < 0.8 ? 0 : 3000, combinesWith: some(classes, 0.8),
      tags: some(['a', 'b'], 0.7), acceptsTags: some(['a', 'b'], 0.7), starts: null, ends: null, supported: true,
    };
  });
  return { plus: true, collections: [{ id: 'c', title: 'C' }], variants, discounts };
}

export function runAppSuite(name: string, open: () => Promise<Driver>): void {
  const loaded = async (store: StoreInput) => {
    const db = await open();
    loadStore(db, store);
    return db;
  };
  const workspace = async () =>
    new Workspace(createSlots([await open(), await open()], await open(), 'memory'), () => NOW);

  test(`${name}: a store read back from the graph audits the same`, async () => {
    for (let seed = 1; seed <= 100; seed++) {
      const store = randomStore(seed);
      const first = await loaded(store);
      const second = await loaded(readStore(first));
      assert.deepEqual(audit(second, SAMPLE_SCENARIO), audit(first, SAMPLE_SCENARIO), `seed ${seed}`);
    }
  });

  test(`${name}: every suggested fix works, previewed and as a real setting change`, async () => {
    let checked = 0;
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 120; seed++) {
      const store = randomStore(seed);
      const db = await loaded(store);
      const before = audit(db, SAMPLE_SCENARIO, { collectLeaks: true });
      for (const row of before.variants.filter((v) => v.state === 'leak')) {
        const fixes = suggestFixes(db, store, before, row.id);
        if (row.leaks.some((l) => !l.stack.length)) {
          assert.equal(fixes.length, 0, 'no setting fixes a price below cost');
          continue;
        }
        assert.ok(fixes.length, `seed ${seed} ${row.id}: no fix`);
        for (const fix of fixes.slice(0, 4)) {
          const scenario = { ...SAMPLE_SCENARIO, asOf: NOW };
          const preview = audit(db, { ...scenario, removed: fix.removed, disabled: fix.disabled });
          const applied = audit(await loaded(applyChanges(store, fix.changes, NOW)), scenario);
          const where = `seed ${seed} ${row.id} ${fix.id}`;
          assert.notEqual(preview.variants.find((v) => v.id === row.id)!.state, 'leak', where);
          assert.deepEqual(
            applied.variants.map((v) => [v.id, v.state, v.worst]),
            preview.variants.map((v) => [v.id, v.state, v.worst]),
            `${where}: the setting differs from its preview`,
          );
          const cleared = before.variants
            .filter((v) => v.state === 'leak' && applied.variants.find((a) => a.id === v.id)!.state !== 'leak')
            .map((v) => v.id);
          assert.deepEqual([...fix.closes].sort(), cleared.sort(), `${where}: closes`);
          for (const change of fix.changes) kinds.add(change.kind);
          checked++;
        }
      }
    }
    assert.ok(checked > 80, `only ${checked} fixes checked`);
    assert.deepEqual([...kinds].sort(), ['class', 'end', 'tag']);
  });

  test(`${name}: the sample gets the smallest sensible fixes`, async () => {
    const w = await workspace();
    const jacket = w.product('jacket');
    assert.deepEqual(jacket.fixes[0].changes, [{ kind: 'class', discount: 'BUNDLE20', value: 'shipping' }]);
    assert.deepEqual(jacket.fixes[0].breaks, [['BUNDLE20', 'FREESHIP']]);
    const preview = w.product('jacket', jacket.fixes[0].id).preview!;
    assert.equal(preview.row.state, 'clear_in_model');
    assert.deepEqual(preview.worst!.outcome, { qty: 1, stack: ['BUNDLE20', 'WELCOME15'], net: 6800, cost: 6500 });
    assert.equal(w.product('boots').fixes[0].breaks.length, 0);
  });

  test(`${name}: receipt lines always add up`, () => {
    const r = seeded(7);
    for (let i = 0; i < 500; i++) {
      const stack = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, j) => {
        const cls = (['product', 'order', 'shipping'] as const)[j === 0 ? Math.floor(r() * 3) : Math.floor(r() * 2)];
        return { id: `d${j}`, class: cls, bps: cls === 'shipping' ? 0 : Math.floor(r() * 4000), off: cls === 'order' ? 99 : 0, minSubtotal: 0 };
      });
      const price = Math.floor(r() * 20000);
      const total = breakdown(stack, price, 2, 800).reduce((sum, line) => sum + line.amount, 0);
      assert.equal(total, netRevenue(stack, price, 2, 800), `case ${i}`);
    }
  });

  test(`${name}: checklist, undo and settings flow`, async () => {
    const w = await workspace();
    const fix = w.product('jacket').fixes[0];
    let s = w.addToChecklist(fix.changes, 'Winter jacket');
    assert.equal(s.app.checklist.length, 1);
    assert.equal(s.audit.counts.leak, 2, 'adding changes nothing');
    s = w.completeChecklistItem(s.app.checklist[0].id);
    assert.equal(s.audit.counts.leak, 1);
    assert.ok(s.app.checklist[0].done && s.canUndo);
    s = w.undo();
    assert.equal(s.audit.counts.leak, 2);
    assert.equal(s.app.checklist[0].done, false);
    s = w.saveSettings({ ...s.app.settings, shippingCost: 0 }, true);
    assert.equal(s.audit.counts.leak, 1, 'free shipping at no cost closes the jacket leak');
    s = w.saveSettings(s.app.settings, false);
    assert.equal(s.audit.counts.leak, 0, 'without Plus the boots tags do not stack');
    assert.throws(() => w.saveSettings({ ...s.app.settings, maxQty: 0 }, false), InputError);
  });

  test(`${name}: cost edits, discount edits and delete`, async () => {
    const w = await workspace();
    assert.equal(w.setCost('gift-box', 1000).audit.counts.unknown, 0);
    assert.equal(w.deleteDiscount('VIP25').audit.counts.leak, 1);
    const welcome = w.snapshot().store.discounts.find((d) => d.id === 'WELCOME15')!;
    assert.throws(() => w.saveDiscount({ ...welcome, id: 'FREESHIP' }, 'WELCOME15'), InputError);
    assert.equal(w.saveDiscount({ ...welcome, bps: 100 }, 'WELCOME15').audit.counts.leak, 0);
  });

  test(`${name}: checking a promotion never writes`, async () => {
    const w = await workspace();
    const before = w.backup();
    const parsed = w.parsePromotion('SUPER: 70% off winter');
    assert.ok(parsed.ok);
    const result = w.checkPromotion(parsed.discount);
    assert.ok(result.leaks.some((l) => l.id === 'jacket' && l.outcome.stack.includes('SUPER')));
    assert.ok(!result.leaks.some((l) => l.id === 'wool-cap'));
    const small = w.parsePromotion('TINY: 1% off accessories');
    assert.ok(small.ok);
    assert.equal(w.checkPromotion(small.discount).leaks.length, 0);
    assert.equal(w.backup(), before);
    assert.throws(() => w.checkPromotion({ ...parsed.discount, id: 'FREESHIP' }), InputError);
  });

  test(`${name}: promotion text is understood or refused`, () => {
    const parse = (text: string) => parsePromotion(text, SAMPLE_STORE);
    const ok = (text: string) => {
      const result = parse(text);
      assert.ok(result.ok, text);
      return result;
    };
    const winter = ok('20% off winter').discount;
    assert.deepEqual([winter.class, winter.bps, winter.collections], ['product', 2000, ['winter']]);
    assert.deepEqual(ok('VIP30: 30% off boots').discount.variants, ['boots']);
    assert.deepEqual(ok('15% off winter jacket').discount.variants, ['jacket']);
    const ship = ok('free shipping over $50').discount;
    assert.deepEqual([ship.class, ship.minSubtotal, ship.allVariants], ['shipping', 5000, true]);
    assert.deepEqual([ok('$10 off').discount.off, ok('$10 off').discount.class], [1000, 'order']);
    assert.equal(ok('₹1,500 off everything').discount.off, 150000);
    assert.equal(ok('10% off accessories').discount.collections[0], 'accessories');
    assert.equal(ok('12.5% off the order').discount.bps, 1250);
    for (const bad of ['', 'winter sale', 'buy 2 get 1 free', '140% off']) assert.equal(parse(bad).ok, false, bad);
  });

  test(`${name}: money and percentages parse without floats`, () => {
    assert.equal(parseMoney('0.29'), 29);
    assert.equal(parseMoney('$1,250.5'), 125050);
    assert.equal(parseMoney('₹1,25,000'), 12500000);
    for (const bad of ['', '-1', '1.234', 'abc', '1e3']) assert.equal(parseMoney(bad), null, bad);
    assert.equal(parsePercent('12.5%'), 1250);
    assert.equal(parsePercent('101'), null);
    assert.equal(formatMoney(-500, 'USD'), '−$5.00');
  });

  test(`${name}: the CSV templates import and find the jacket leak`, async () => {
    const store = importCsv({ products: PRODUCTS_TEMPLATE, discounts: DISCOUNTS_TEMPLATE }, false);
    const result = audit(await loaded(store), SAMPLE_SCENARIO);
    assert.equal(result.variants.find((v) => v.id === 'jacket')!.state, 'leak');
  });

  test(`${name}: CSV handles quotes, BOM and CRLF, and names the bad line`, () => {
    assert.deepEqual(parseCsv('﻿a,b\r\n"x, ""y""","two\nlines"\r\nz,w\r\n'), [
      { line: 1, cells: ['a', 'b'] },
      { line: 2, cells: ['x, "y"', 'two\nlines'] },
      { line: 4, cells: ['z', 'w'] },
    ]);
    const products = 'id,title,price,cost,collections\ncap,"Cap, wool",30,oops,Winter\ncap,Again,30,10,Winter\n';
    const discounts = 'code,class,type,percent,applies_to,combines_with\nA,order,percent,10,collection:Summer,product\n';
    assert.throws(
      () => importCsv({ products, discounts }, false),
      (e) =>
        e instanceof InputError &&
        e.issues.some((i) => i.startsWith('products.csv, line 2')) &&
        e.issues.some((i) => i.startsWith('products.csv, line 3')) &&
        e.issues.some((i) => i.startsWith('discounts.csv, line 2')),
    );
  });

  test(`${name}: CSV keeps unmodeled discounts as Unknown, and non-Latin collections apart`, async () => {
    const products = 'id,title,price,cost,collections\na,A,100,20,सर्दी\nb,B,100,20,गर्मी\n';
    const discounts = 'code,class,type,applies_to,combines_with\nBOGO,product,bxgy,collection:सर्दी,\n';
    const store = importCsv({ products, discounts }, false);
    assert.equal(store.collections.length, 2);
    assert.deepEqual(audit(await loaded(store), SAMPLE_SCENARIO).variants.map((v) => v.state), ['unknown', 'clear_in_model']);
  });

  test(`${name}: backup restores the same audit, bad files change nothing`, async () => {
    const first = await workspace();
    first.setCost('gift-box', 1000);
    first.addToChecklist(first.product('boots').fixes[0].changes, 'Leather boots');
    const second = await workspace();
    const restored = second.restore(first.backup());
    assert.deepEqual(restored.audit, first.snapshot().audit);
    assert.deepEqual(restored.app, first.snapshot().app);

    const good = second.backup();
    for (const bad of ['nope', '{}', '{"format":"discount-audit","version":1,"store":{},"app":{}}']) {
      assert.throws(() => second.restore(bad), InputError);
    }
    const damaged = JSON.parse(good);
    damaged.app.settings.maxQty = 999;
    assert.throws(() => second.restore(JSON.stringify(damaged)), InputError);
    assert.equal(second.backup(), good);
  });

  test(`${name}: an interrupted save leaves the previous store in charge`, async () => {
    const a = await open();
    const b = await open();
    const slots = createSlots([a, b], await open(), 'memory');
    slots.replace((db) => loadStore(db, SAMPLE_STORE));
    assert.throws(() =>
      slots.replace((db) => {
        loadStore(db, randomStore(3));
        throw new Error('tab closed');
      }),
    );
    for (const current of [slots, createSlots([a, b], await open(), 'memory')]) {
      assert.equal(readStore(current.active()!).variants.length, 50);
    }
    slots.replace((db) => loadStore(db, randomStore(4)));
    const reopened = createSlots([a, b], await open(), 'memory');
    assert.equal(readStore(reopened.active()!).variants.length, randomStore(4).variants.length);
    assert.equal(Number(b.query<{ generation: number }>(queries.READ_COMPLETE)[0].generation), 2);
  });

  test(`${name}: the report escapes store text and loads nothing external`, async () => {
    const w = await workspace();
    const store = structuredClone(w.snapshot().store);
    store.variants.find((v) => v.id === 'jacket')!.title = '<img src=x onerror=alert(1)>';
    w.useImport(store, '<script>x</script>');
    const html = w.report();
    assert.ok(!/<script|<img|https?:/i.test(html));
    assert.ok(html.includes('&lt;img') && html.includes('loses $5.00'));
  });

  test(`${name}: a store with no app node still opens`, async () => {
    const db = await loaded(SAMPLE_STORE);
    const w = new Workspace({ saved: 'read-only', active: () => db, replace: () => assert.fail(), scratch: () => db });
    assert.deepEqual(w.snapshot().app, defaultState(true));
  });
}
