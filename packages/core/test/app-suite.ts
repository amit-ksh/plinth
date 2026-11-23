import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  applyChanges, audit, breakdown, defaultState, explainStack, fromShopify, TEMPLATES, DISCOUNTS_TEMPLATE, formatMoney, importCsv, InputError, loadStore,
  netRevenue, parseCsv, parseMoney, parsePercent, parsePromotion, PRODUCTS_TEMPLATE, queries, readStore, SAMPLE_SCENARIO,
  SAMPLE_STORE, suggestFixes, Workspace,
  type Discount, type Driver, type StoreInput,
} from '../src/index.ts';
import { createSlots } from '../src/slots.ts';
import { SHOPIFY_GOLDEN } from './shopify-golden.ts';

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

  test(`${name}: product images import from CSV, survive the graph, and must be https`, async () => {
    const discounts = 'code,class,type,percent,applies_to,combines_with\nA,order,percent,10,all,\n';
    const products = 'id,title,price,cost,collections,Image Src\na,A,100,20,Winter,https://cdn.example.com/a.jpg\nb,B,100,20,Winter,\n';
    const store = importCsv({ products, discounts }, false);
    assert.equal(store.variants[0].image, 'https://cdn.example.com/a.jpg');
    assert.equal('image' in store.variants[1], false);
    const back = readStore(await loaded(store));
    assert.equal(back.variants.find((v) => v.id === 'a')!.image, 'https://cdn.example.com/a.jpg');
    assert.equal('image' in back.variants.find((v) => v.id === 'b')!, false);
    assert.throws(
      () => importCsv({ products: products.replace('https://cdn', 'javascript://cdn'), discounts }, false),
      (e) => e instanceof InputError && e.issues.some((i) => i.startsWith('products.csv, line 2') && i.includes('https://')),
    );
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

  test(`${name}: matches a real Shopify Plus checkout engine on 13 carts`, async () => {
    const db = await loaded(SAMPLE_STORE);
    const discount = new Map(SAMPLE_STORE.discounts.map((d) => [d.id, d]));
    const variant = new Map(SAMPLE_STORE.variants.map((v) => [v.id, v]));
    for (const cart of SHOPIFY_GOLDEN) {
      const pairs = (cart.applied.length * (cart.applied.length - 1)) / 2;
      assert.equal(explainStack(db, cart.applied).length, pairs, `${cart.name}: every applied pair combines`);
      for (const code of cart.rejected) {
        assert.ok(cart.applied.some((a) => explainStack(db, [code, a]).length === 0), `${cart.name}: ${code} is blocked`);
      }
      const v = variant.get(cart.variant)!;
      const net = netRevenue(cart.applied.map((id) => discount.get(id)!), v.price, cart.qty, 0);
      assert.equal(net, cart.total, `${cart.name}: total`);
    }
    // Receipt lines follow Shopify's allocation: the larger product percentage first (VIP25 $25, then BOOT20 $15).
    const lines = breakdown(['BOOT20', 'VIP25'].map((id) => ({ ...discount.get(id)!, id })), 10000, 1, 0);
    assert.deepEqual(lines.slice(1).map((l) => [l.label, l.amount]), [['VIP25', -2500], ['BOOT20', -1500]]);
  });

  test(`${name}: a real Shopify store imports and shows the same two leaks`, async () => {
    const result = fromShopify(JSON.parse(readFileSync(new URL('./shopify-fixture.json', import.meta.url), 'utf8')));
    assert.equal(result.storeName, 'plinth-test');
    assert.equal(result.currency, 'USD');
    assert.equal(result.store.plus, true);
    assert.ok(result.notes.some((n) => n.includes('Buy X Get Y')));
    assert.ok(result.notes.some((n) => n.includes('gift card')));
    const byTitle = new Map(result.store.variants.map((v) => [v.title, v]));
    assert.equal(byTitle.get('Winter jacket')!.cost, 6500);
    assert.equal(byTitle.get('Gift box')!.cost, null);
    assert.ok([...byTitle.keys()].every((t) => !t.startsWith('Gift Card')));
    const vip = result.store.discounts.find((d) => d.id === 'VIP25')!;
    assert.deepEqual([vip.tags, vip.acceptsTags], [['vip'], ['boots', 'flash']]);

    const audited = audit(await loaded(result.store), SAMPLE_SCENARIO);
    const leaks = audited.variants.filter((v) => v.state === 'leak');
    const loss = (title: string) => {
      const v = leaks.find((l) => l.title === title)!;
      return v.worst!.cost - v.worst!.net;
    };
    assert.deepEqual(leaks.map((v) => v.title).sort(), ['Leather boots', 'Winter jacket']);
    assert.equal(loss('Winter jacket'), 500);
    assert.equal(loss('Leather boots'), 200);
  });

  test(`${name}: the guard names the products an edit would put below cost`, async () => {
    const w = await workspace();
    const knit = w.snapshot().store.discounts.find((d) => d.id === 'KNIT10')!;
    assert.deepEqual(w.checkDiscount(knit, 'KNIT10').leaks, []);
    const deep = { ...knit, bps: 8000 };
    const check = w.checkDiscount(deep, 'KNIT10');
    assert.ok(check.leaks.length > 0 && check.leaks.every((l) => l.id.startsWith('knitwear')));
    assert.throws(() => w.checkDiscount({ ...knit, id: 'BUNDLE20' }, 'KNIT10'), InputError);
    // Checking never saves.
    assert.equal(w.snapshot().store.discounts.find((d) => d.id === 'KNIT10')!.bps, 1000);
  });

  test(`${name}: every change is in the history and can be rolled back`, async () => {
    const w = await workspace();
    const before = w.snapshot().store;
    const knit = before.discounts.find((d) => d.id === 'KNIT10')!;
    w.saveDiscount({ ...knit, bps: 3000 }, 'KNIT10');
    w.saveDiscount({ ...knit, id: 'NEW5', title: 'New', bps: 500 });
    w.deleteDiscount('EXTRAS10');
    let history = w.snapshot().app.history;
    assert.deepEqual(history.map((e) => [e.action, e.discount]), [['update', 'KNIT10'], ['create', 'NEW5'], ['delete', 'EXTRAS10']]);

    // A change made again since can't be rolled back out of order.
    w.saveDiscount({ ...knit, bps: 3500 }, 'KNIT10');
    assert.throws(() => w.rollbackPlan(history[0].id), /changed again/);

    history = w.snapshot().app.history;
    for (const entry of [...history].reverse()) w.rollback(entry.id);
    const after = w.snapshot();
    assert.deepEqual(after.store.discounts.map((d) => d.id).sort(), before.discounts.map((d) => d.id).sort());
    assert.equal(after.store.discounts.find((d) => d.id === 'KNIT10')!.bps, 1000);
    assert.ok(after.app.history.slice(0, 4).every((e) => e.rolledBack));
    assert.throws(() => w.rollback(history[0].id), /already rolled back/);

    // History survives a backup and restore, and old backups without it still load.
    const restored = (await workspace()).restore(w.backup());
    assert.equal(restored.app.history.length, after.app.history.length);
    const old = JSON.parse(w.backup());
    delete old.app.history;
    delete old.app.shopify;
    assert.deepEqual((await workspace()).restore(JSON.stringify(old)).app.history, []);
  });

  test(`${name}: a checklist fix is recorded so it can be rolled back`, async () => {
    const w = await workspace();
    const fix = w.product('boots').fixes[0];
    w.addToChecklist(fix.changes, 'Leather boots');
    const snap = w.completeChecklistItem(w.snapshot().app.checklist[0].id);
    const entry = snap.app.history.at(-1)!;
    assert.equal(entry.action, 'fix');
    assert.equal(snap.audit.variants.find((v) => v.id === 'boots')!.state === 'leak', false);
    assert.equal(w.rollback(entry.id).audit.variants.find((v) => v.id === 'boots')!.state, 'leak');
  });

  test(`${name}: the calendar shows a scheduled sale's leak only on its days`, async () => {
    const w = await workspace();
    const day = 86_400_000;
    const start = new Date(NOW);
    start.setHours(0, 0, 0, 0);
    const opens = start.getTime() + 4 * day;
    const closes = opens + 3 * day;
    // 40% off winter, stacking with WELCOME15's order class, only for three days.
    w.saveDiscount({ ...w.snapshot().store.discounts.find((d) => d.id === 'BUNDLE20')!, id: 'BFCM40', title: 'BFCM', bps: 4000, starts: opens, ends: closes });
    const cal = w.calendar(14);
    const during = cal.segments.find((s) => s.start === opens)!;
    const outside = cal.segments.find((s) => s.start === cal.start)!;
    assert.ok(during.active.includes('BFCM40') && !outside.active.includes('BFCM40'));
    const jacket = (s: typeof during) => s.leaks.find((l) => l.id === 'jacket')!.loss;
    assert.ok(jacket(during) > jacket(outside), 'the sale deepens the jacket loss on its days');
    assert.equal(cal.segments.at(-1)!.end, cal.end);
    assert.throws(() => w.calendar(0), InputError);
  });

  test(`${name}: every template builds a valid discount, and the guard checks it`, async () => {
    const w = await workspace();
    const store = w.snapshot().store;
    for (const t of TEMPLATES) {
      const d = t.build(store);
      assert.ok(!store.discounts.some((x) => x.id === d.id), t.id);
      w.checkDiscount(d);
    }
    const clearance = { ...TEMPLATES.find((t) => t.id === 'clearance')!.build(store), collections: ['winter'] };
    assert.ok(w.checkDiscount(clearance).leaks.some((l) => l.id === 'jacket'), 'a 40% clearance on winter sells the jacket below cost');
    const sitewide = TEMPLATES.find((t) => t.id === 'sitewide')!.build(store);
    assert.deepEqual(w.checkDiscount(sitewide).leaks, [], 'a 25% sitewide sale that combines with shipping only is safe here');
    {
    }
  });

  test(`${name}: guardrails catch margins below a collection's floor, and Block refuses the save`, async () => {
    const w = await workspace();
    const knit = w.snapshot().store.discounts.find((d) => d.id === 'KNIT10')!;
    // 50% off knitwear stays above cost (cost is a quarter of price) but leaves a 41% margin with WELCOME15, under a 45% floor.
    const deep = { ...knit, bps: 5000 };
    assert.deepEqual(w.checkDiscount(deep, 'KNIT10').belowFloor, []);
    w.saveGuardrails({ collections: { knitwear: 4500 }, mode: 'warn' });
    const warned = w.checkDiscount(deep, 'KNIT10');
    assert.equal(warned.leaks.length, 0);
    assert.ok(warned.belowFloor.length > 0 && warned.belowFloor.every((b) => b.id.startsWith('knitwear') && b.floorBps === 4500));
    assert.equal(warned.blocked, false);
    // The audit marks knitwear Thin against its own floor, and leaves other collections alone.
    const audited = w.snapshot().audit.variants;
    assert.ok(audited.filter((v) => v.id.startsWith('home-')).every((v) => v.state !== 'thin'));

    w.saveGuardrails({ collections: { knitwear: 4500 }, mode: 'block' });
    assert.equal(w.checkDiscount(deep, 'KNIT10').blocked, true);
    assert.throws(() => w.saveDiscount(deep, 'KNIT10'), /guardrails block/);
    // Ending a discount is never blocked.
    w.saveDiscount({ ...knit, ends: NOW }, 'KNIT10', { action: 'end' });
    assert.throws(() => w.saveGuardrails({ collections: { nope: 100 }, mode: 'warn' }), InputError);
    assert.throws(() => w.saveGuardrails({ collections: { knitwear: 10000 }, mode: 'warn' }), InputError);
    // Guardrails survive a backup and restore.
    assert.deepEqual((await workspace()).restore(w.backup()).app.guardrails, { collections: { knitwear: 4500 }, mode: 'block' });
  });

  test(`${name}: pause all ends every live discount as one batch, and resume all restores them`, async () => {
    const w = await workspace();
    const live = w.pausePlan();
    assert.ok(live.length >= 10);
    const paused = w.pauseAll(live.map((d) => d.id), { at: NOW });
    assert.equal(paused.audit.counts.leak, 0, 'nothing leaks with every discount ended');
    const batch = paused.app.history.at(-1)!.batch!;
    assert.ok(paused.app.history.slice(-live.length).every((e) => e.batch === batch && e.action === 'pause'));
    assert.equal(w.pausePlan().length, 0);
    assert.throws(() => w.pauseAll(['BUNDLE20']), /No discount is live/);

    const plan = w.batchPlan(batch);
    assert.equal(plan.length, live.length);
    const resumed = w.rollbackBatch(batch, plan.map((p) => p.entry));
    assert.equal(resumed.audit.counts.leak, 2);
    assert.throws(() => w.batchPlan(batch), /already undone/);
  });

  test(`${name}: a store with no app node still opens`, async () => {
    const db = await loaded(SAMPLE_STORE);
    const w = new Workspace({ saved: 'read-only', active: () => db, replace: () => assert.fail(), scratch: () => db });
    assert.deepEqual(w.snapshot().app, defaultState(true));
  });
}
