import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  audit, explainStack, InputError, loadStore, netRevenue, SAMPLE_SCENARIO, SAMPLE_STORE,
  type Discount, type DiscountClass, type Driver, type Scenario, type StoreInput, type Variant,
} from '../src/index.ts';
import { findLeaks } from './oracle.ts';

const ALL: DiscountClass[] = ['product', 'order', 'shipping'];

const discount = (id: string, more: Partial<Discount> = {}): Discount => ({
  id, title: id, class: 'order', method: 'automatic', bps: 0, off: 0, allVariants: true, variants: [], collections: [],
  minSubtotal: 0, combinesWith: ALL, tags: ['t'], acceptsTags: ['t'], starts: null, ends: null, supported: true,
  ...more,
});
const variant = (more: Partial<Variant> = {}): Variant =>
  ({ id: 'v', title: 'v', price: 10000, cost: 1000, collections: [], ...more });
const single = (discounts: Discount[], v: Partial<Variant> = {}): StoreInput =>
  ({ plus: true, collections: [], variants: [variant(v)], discounts });

/** mulberry32, so a failing case can be replayed from its seed. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomStore(seed: number): { store: StoreInput; scenario: Scenario } {
  const r = seeded(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const some = <T>(xs: readonly T[], p: number) => xs.filter(() => r() < p);
  const collections = ['c0', 'c1', 'c2'];

  const variants = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, i) => variant({
    id: `v${i}`,
    price: pick([0, 999, 1999, 5000, 10000, 12345]),
    cost: pick([null, 0, 500, 2500, 4000, 6500, 9000]),
    collections: some(collections, 0.4),
  }));

  const dense = r() < 0.4;
  const discounts = Array.from({ length: Math.floor(r() * 10) }, (_, i) => {
    const cls = pick(['product', 'product', 'order', 'order', 'shipping'] as const);
    const starts = r() < 0.25 ? Math.floor(r() * 10) : null;
    return discount(`d${i}`, {
      class: cls,
      method: pick(['code', 'automatic'] as const),
      bps: cls === 'shipping' ? 0 : pick([0, 333, 1000, 1500, 2500, 5000, 10000]),
      off: cls === 'shipping' || r() < 0.65 ? 0 : pick([1, 99, 500, 3000]),
      allVariants: r() < 0.5,
      variants: some(variants.map((v) => v.id), 0.35),
      collections: ['c0', ...some(collections.slice(1), 0.3)],
      minSubtotal: r() < 0.7 ? 0 : pick([999, 3000, 5000, 8000, 10000]),
      combinesWith: some(ALL, dense ? 0.95 : 0.65),
      tags: some(['a', 'b', 'c'], dense ? 0.9 : 0.5),
      acceptsTags: some(['a', 'b', 'c'], dense ? 0.9 : 0.5),
      starts,
      ends: r() < 0.25 ? (starts ?? 0) + 1 + Math.floor(r() * 8) : null,
      supported: r() > 0.07,
    });
  });

  return {
    store: { plus: r() > 0.15, collections: collections.map((id) => ({ id, title: id })), variants, discounts },
    scenario: { shippingCost: pick([0, 800, 1250]), maxQty: 1 + Math.floor(r() * 4) },
  };
}

export function runEngineSuite(name: string, open: () => Promise<Driver>): void {
  const load = async (store: StoreInput) => {
    const db = await open();
    loadStore(db, store);
    return db;
  };
  const run = async (store: StoreInput, scenario: Partial<Scenario> = {}) =>
    audit(await load(store), { ...SAMPLE_SCENARIO, ...scenario }, { collectLeaks: true });

  test(`${name}: sample has two leaks, one unknown and 47 clear`, async () => {
    const result = await run(SAMPLE_STORE);
    assert.deepEqual(result.counts, { leak: 2, thin: 0, unknown: 1, clear_in_model: 47 });
    const by = new Map(result.variants.map((v) => [v.id, v]));
    assert.deepEqual(by.get('jacket')!.worst, { qty: 1, stack: ['BUNDLE20', 'FREESHIP', 'WELCOME15'], net: 6000, cost: 6500 });
    assert.deepEqual(by.get('boots')!.worst, { qty: 1, stack: ['BOOT20', 'VIP25'], net: 6000, cost: 6200 });
    assert.deepEqual(by.get('gift-box')!.unknown, ['missing_cost']);
    assert.ok(!by.get('boots')!.leaks.some((l) => l.stack.length === 3), 'a chain is not a group');
  });

  test(`${name}: every pair in a stack explains itself`, async () => {
    const db = await load(SAMPLE_STORE);
    const pairs = explainStack(db, ['BUNDLE20', 'FREESHIP', 'WELCOME15']);
    assert.deepEqual(pairs.map((p) => p.key), ['BUNDLE20|FREESHIP', 'BUNDLE20|WELCOME15', 'FREESHIP|WELCOME15']);
    assert.ok(pairs.every((p) => p.rule.startsWith('Both discounts allow')));
    assert.match(explainStack(db, ['BOOT20', 'VIP25'])[0].rule, /tag/);
  });

  test(`${name}: simulation closes leaks and writes nothing`, async () => {
    const db = await load(SAMPLE_STORE);
    const before = audit(db, SAMPLE_SCENARIO);
    assert.equal(audit(db, { ...SAMPLE_SCENARIO, removed: ['BUNDLE20|FREESHIP'] }).counts.leak, 1);
    assert.equal(audit(db, { ...SAMPLE_SCENARIO, disabled: ['BUNDLE20', 'BOOT20'] }).counts.leak, 0);
    assert.deepEqual(audit(db, SAMPLE_SCENARIO), before);
  });

  test(`${name}: an unsupported discount is Unknown`, async () => {
    const result = await run(single([discount('fn', { supported: false })]));
    assert.equal(result.variants[0].state, 'unknown');
    assert.deepEqual(result.variants[0].unknown, ['unsupported_discount']);
  });

  test(`${name}: a proven leak outranks Unknown`, async () => {
    const result = await run(single([discount('fn', { supported: false }), discount('big', { bps: 9500 })]));
    assert.equal(result.variants[0].state, 'leak');
  });

  test(`${name}: below cost with no discount is a leak`, async () => {
    assert.equal((await run(single([], { price: 900 }))).variants[0].state, 'leak');
  });

  test(`${name}: a margin floor gives Thin`, async () => {
    const store = single([], { cost: 9000 });
    assert.equal((await run(store, { floorBps: 2000 })).variants[0].state, 'thin');
    assert.equal((await run(store)).variants[0].state, 'clear_in_model');
  });

  test(`${name}: an ended discount is left out`, async () => {
    const store = single([discount('old', { bps: 9500, ends: 100 })]);
    assert.equal((await run(store, { asOf: 99 })).variants[0].state, 'leak');
    assert.equal((await run(store, { asOf: 100 })).variants[0].state, 'clear_in_model');
  });

  test(`${name}: eight compatible discounts are complete, nine are Unknown`, async () => {
    const many = (n: number) => single(Array.from({ length: n }, (_, i) => discount(`o${i}`, { bps: 100 })));
    assert.equal((await run(many(8))).variants[0].state, 'clear_in_model');
    assert.deepEqual((await run(many(9))).variants[0].unknown, ['search_incomplete']);
  });

  test(`${name}: at most five codes share one order`, async () => {
    // Five 15% codes keep $25. A sixth would keep $10, below the $20 cost.
    const six = (method: Discount['method']) =>
      single(Array.from({ length: 6 }, (_, i) => discount(`c${i}`, { method, bps: 1500 })), { cost: 2000 });
    assert.equal((await run(six('code'))).variants[0].state, 'clear_in_model');
    assert.equal((await run(six('automatic'))).variants[0].state, 'leak');
  });

  test(`${name}: bad input is refused before anything is written`, async () => {
    const db = await open();
    const bad = single([
      discount('a|b'),
      discount('empty', { starts: 5, ends: 5 }),
      discount('twin'),
      discount('twin'),
      discount('part', { class: 'shipping', bps: 5000 }),
    ]);
    assert.throws(() => loadStore(db, bad), (e) => e instanceof InputError && e.issues.length === 4);
    assert.equal(Number(db.query<{ n: number }>('MATCH (n) RETURN count(n) AS n')[0].n), 0);
  });

  test(`${name}: money rounds halves up, including below zero`, () => {
    const percent = (bps: number) => ({ class: 'product' as const, bps, off: 0, minSubtotal: 0 });
    const shipping = { class: 'shipping' as const, bps: 0, off: 0, minSubtotal: 0 };
    assert.equal(netRevenue([percent(5000)], 1001, 1, 0), 501);
    assert.equal(netRevenue([percent(5000), shipping], 1, 1, 1), 0);
    assert.equal(netRevenue([percent(10000), shipping], 1000, 1, 800), -800);
  });

  test(`${name}: matches the independent evaluator on 400 random stores`, async () => {
    let compared = 0;
    let largest = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const { store, scenario } = randomStore(seed);
      const result = await run(store, scenario);
      const key = (id: string, l: { qty: number; stack: string[]; net: number; cost: number }) =>
        `${id} q${l.qty} ${l.stack.join('|')} ${l.net}/${l.cost}`;
      const ours = result.variants
        .flatMap((v) => v.leaks.filter((l) => l.stack.length).map((l) => key(v.id, l)))
        .sort();
      const reference = findLeaks({ plus: store.plus, ...scenario, variants: store.variants, discounts: store.discounts })
        .map((l) => key(l.variant, l))
        .sort();
      assert.deepEqual(ours, reference, `seed ${seed}`);
      compared += reference.length;
      for (const v of result.variants) for (const l of v.leaks) largest = Math.max(largest, l.stack.length);
    }
    assert.ok(compared > 1000 && largest >= 4, `weak generator: ${compared} leaks, largest stack ${largest}`);
    console.log(`${name} differential: ${compared} leaks compared, largest stack ${largest}`);
  });

  test(`${name}: 500 variants and 15 discounts audit in under 3 seconds`, async () => {
    const collections = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, title: `c${i}` }));
    const variants = Array.from({ length: 500 }, (_, i) => variant({
      id: `v${i}`, price: 2000 + (i % 97) * 250, cost: 600 + (i % 53) * 100, collections: [`c${i % 6}`],
    }));
    const discounts = Array.from({ length: 15 }, (_, i) => discount(`d${i}`, {
      class: i === 0 ? 'shipping' : i < 4 ? 'order' : 'product',
      bps: i === 0 ? 0 : 500 + (i % 4) * 250,
      allVariants: i < 4,
      collections: i < 4 ? [] : [`c${i % 6}`, `c${(i + 1) % 6}`],
    }));
    const db = await load({ plus: true, collections, variants, discounts });
    const start = performance.now();
    const result = audit(db, SAMPLE_SCENARIO);
    const ms = performance.now() - start;
    console.log(`${name} load gate: ${Math.round(ms)}ms, ${result.groupsSearched} groups`);
    assert.equal(result.variants.length, 500);
    assert.ok(ms < 3000, `${ms}ms`);
  });
}
