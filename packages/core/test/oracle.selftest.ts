import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canCombine, findLeaks } from './oracle.ts';
import type { DiscountClass, OracleDiscount, OracleInput, OracleVariant } from './oracle.ts';

function d(id: string, cls: DiscountClass, p: Partial<OracleDiscount> = {}): OracleDiscount {
  return {
    id, class: cls, method: 'automatic', bps: 0, off: 0, allVariants: true, variants: [],
    collections: [], minSubtotal: 0, combinesWith: [], tags: [], acceptsTags: [],
    starts: null, ends: null, supported: true, ...p,
  };
}
function v(price: number, cost: number | null, id = 'v1', collections: string[] = []): OracleVariant {
  return { id, price, cost, collections };
}
function inp(variants: OracleVariant[], discounts: OracleDiscount[], p: Partial<OracleInput> = {}): OracleInput {
  return { plus: true, shippingCost: 800, maxQty: 1, variants, discounts, ...p };
}
const stacks = (r: { stack: string[] }[]) => r.map((x) => x.stack.join('|'));

test('product 20% + order 15% + free shipping costing 800', () => {
  const r = findLeaks(inp([v(10000, 6500)], [
    d('P', 'product', { bps: 2000, combinesWith: ['order', 'shipping'] }),
    d('O', 'order', { bps: 1500, combinesWith: ['product', 'shipping'] }),
    d('S', 'shipping', { combinesWith: ['product', 'order'] }),
  ]));
  assert.deepEqual(r, [{ variant: 'v1', qty: 1, stack: ['O', 'P', 'S'], net: 6000, cost: 6500 }]);
});

test('chain A-B, B-C without A-C never forms a three-stack', () => {
  const r = findLeaks(inp([v(10000, 4000)], [
    d('A', 'product', { bps: 5000, combinesWith: ['product'], tags: ['a'], acceptsTags: ['b'] }),
    d('B', 'product', { bps: 5000, combinesWith: ['product'], tags: ['b'], acceptsTags: ['a', 'c'] }),
    d('C', 'product', { bps: 5000, combinesWith: ['product'], tags: ['c'], acceptsTags: ['b'] }),
  ]));
  assert.deepEqual(stacks(r), ['A|B', 'B|C']);
  assert.equal(r[0].net, 2500);
  assert.equal(r[0].cost, 4000);
});

test('product pairs need two-way tag acceptance', () => {
  const a = d('A', 'product', { combinesWith: ['product'], tags: ['a'], acceptsTags: ['b'] });
  const b = d('B', 'product', { combinesWith: ['product'], tags: ['b'], acceptsTags: [] });
  assert.equal(canCombine(a, b, true), false);
  assert.equal(canCombine(b, a, true), false);
  const b2 = d('B', 'product', { combinesWith: ['product'], tags: ['b'], acceptsTags: ['a'] });
  assert.equal(canCombine(a, b2, true), true);
  assert.equal(canCombine(b2, a, true), true);
  const b3 = d('B', 'product', { combinesWith: [], tags: ['b'], acceptsTags: ['a'] });
  assert.equal(canCombine(a, b3, true), false);
});

test('plus=false blocks product pairs', () => {
  const a = d('A', 'product', { bps: 5000, combinesWith: ['product'], tags: ['t'], acceptsTags: ['t'] });
  const b = d('B', 'product', { bps: 5000, combinesWith: ['product'], tags: ['t'], acceptsTags: ['t'] });
  assert.equal(canCombine(a, b, false), false);
  assert.equal(canCombine(a, b, true), true);
  assert.deepEqual(stacks(findLeaks(inp([v(10000, 4000)], [a, b], { plus: false }))), []);
  assert.deepEqual(stacks(findLeaks(inp([v(10000, 4000)], [a, b], { plus: true }))), ['A|B']);
});

test('other class pairs', () => {
  const o1 = d('O1', 'order', { combinesWith: ['order'] });
  const o2 = d('O2', 'order', { combinesWith: ['order'] });
  assert.equal(canCombine(o1, o2, false), true);
  const s1 = d('S1', 'shipping', { combinesWith: ['shipping'] });
  const s2 = d('S2', 'shipping', { combinesWith: ['shipping'] });
  assert.equal(canCombine(s1, s2, true), false);
  assert.equal(canCombine(o1, o1, true), false);
  const p = d('P', 'product', { combinesWith: ['order'] });
  assert.equal(canCombine(p, d('O', 'order', { combinesWith: [] }), true), false);
  assert.equal(canCombine(p, d('O', 'order', { combinesWith: ['product'] }), true), true);
});

test('thresholds at equality', () => {
  const run = (pMin: number) => findLeaks(inp([v(10000, 4000)], [
    d('P', 'product', { bps: 5000, minSubtotal: pMin }),
  ]));
  assert.equal(run(10000).length, 0); // net 5000 not a leak at cost 4000; use cost below
  const leakP = (pMin: number) => findLeaks(inp([v(10000, 6000)], [d('P', 'product', { bps: 5000, minSubtotal: pMin })]));
  assert.equal(leakP(10000).length, 1); // minSubtotal == listed ok
  assert.equal(leakP(10001).length, 0);
  const leakO = (oMin: number) => findLeaks(inp([v(10000, 6000)], [d('O', 'order', { bps: 5000, minSubtotal: oMin })]));
  assert.equal(leakO(10000).length, 1); // == sub
  assert.equal(leakO(10000.0000005).length, 1); // within epsilon
  assert.equal(leakO(10000.000002).length, 0);
  // order threshold sees sub after product discount: 8000
  const mk = (oMin: number) => findLeaks(inp([v(10000, 6000)], [
    d('P', 'product', { bps: 2000, combinesWith: ['order'] }),
    d('O', 'order', { bps: 5000, minSubtotal: oMin, combinesWith: ['product'] }),
  ]));
  assert.ok(stacks(mk(8000)).includes('O|P'));
  assert.ok(!stacks(mk(8001)).includes('O|P'));
});

test('five-code limit', () => {
  const six = (method: 'code' | 'automatic') => ['1', '2', '3', '4', '5', '6'].map((i) =>
    d('D' + i, 'order', { method, bps: 1000, combinesWith: ['order'] }));
  // revenue = 10000 - 1000k. cost 5500: leak iff k >= 5.
  const codes = findLeaks(inp([v(10000, 5500)], six('code')));
  assert.equal(codes.length, 6);
  assert.ok(codes.every((x) => x.stack.length === 5 && x.net === 5000));
  // cost 4500: only k=6 would leak, forbidden for codes
  assert.equal(findLeaks(inp([v(10000, 4500)], six('code'))).length, 0);
  const auto = findLeaks(inp([v(10000, 4500)], six('automatic')));
  assert.equal(auto.length, 1);
  assert.equal(auto[0].net, 4000);
  // shipping code discounts are not counted
});

test('eight-discount cap', () => {
  const nine = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((i) =>
    d('D' + i, 'order', { bps: 500, combinesWith: ['order'] }));
  const r = findLeaks(inp([v(10000, 6500)], nine));
  assert.equal(r.length, 9);
  assert.ok(r.every((x) => x.stack.length === 8 && x.net === 6000));
});

test('date intervals: touching does not overlap', () => {
  const mk = (aEnd: number | null, bStart: number | null) => [
    d('A', 'order', { combinesWith: ['order'], starts: 0, ends: aEnd }),
    d('B', 'order', { combinesWith: ['order'], starts: bStart, ends: null }),
  ];
  const [a1, b1] = mk(100, 100);
  assert.equal(canCombine(a1, b1, true), false);
  assert.equal(canCombine(b1, a1, true), false);
  const [a2, b2] = mk(101, 100);
  assert.equal(canCombine(a2, b2, true), true);
  const [a3, b3] = mk(null, null);
  assert.equal(canCombine(a3, b3, true), true);
});

test('single discount leak, multiple quantities', () => {
  const r = findLeaks(inp([v(10000, 6000)], [d('P', 'product', { bps: 5000 })], { maxQty: 2 }));
  assert.deepEqual(r, [
    { variant: 'v1', qty: 1, stack: ['P'], net: 5000, cost: 6000 },
    { variant: 'v1', qty: 2, stack: ['P'], net: 10000, cost: 12000 },
  ]);
});

test('null cost is skipped', () => {
  assert.deepEqual(findLeaks(inp([v(10000, null)], [d('P', 'product', { bps: 10000 })])), []);
});

test('clamping at zero', () => {
  const r = findLeaks(inp([v(10000, 1)], [d('P', 'product', { off: 20000 })]));
  assert.deepEqual(r, [{ variant: 'v1', qty: 1, stack: ['P'], net: 0, cost: 1 }]);
  const r2 = findLeaks(inp([v(10000, 1)], [d('O', 'order', { off: 20000 })]));
  assert.equal(r2[0].net, 0);
  // fixed product off scales with qty
  const r3 = findLeaks(inp([v(1000, 900)], [d('P', 'product', { off: 200 })], { maxQty: 3 }));
  assert.deepEqual(r3.map((x) => [x.qty, x.net, x.cost]), [[1, 800, 900], [2, 1600, 1800], [3, 2400, 2700]]);
});

test('rounding and negative net', () => {
  const r = findLeaks(inp([v(1001, 600)], [d('P', 'product', { bps: 5000 })]));
  assert.equal(r[0].net, 501); // 500.5 rounds up
  const s = findLeaks(inp([v(500, 400)], [d('S', 'shipping')]));
  assert.deepEqual(s, [{ variant: 'v1', qty: 1, stack: ['S'], net: -300, cost: 400 }]);
});

test('applicability, unsupported, ordering, limits', () => {
  const vs = [v(10000, 6000, 'b', ['c1']), v(10000, 6000, 'a')];
  const r = findLeaks(inp(vs, [
    d('X', 'product', { bps: 5000, allVariants: false, collections: ['c1'] }),
    d('Y', 'product', { bps: 5000, allVariants: false, variants: ['a'] }),
    d('Z', 'product', { bps: 5000, supported: false }),
  ]));
  assert.deepEqual(r.map((x) => x.variant + ':' + x.stack.join('|')), ['a:Y', 'b:X']);
  assert.throws(() => findLeaks(inp([v(1, 1)], Array.from({ length: 19 }, (_, i) => d('D' + i, 'order')))));
  // plain string comparison: uppercase before lowercase
  const r2 = findLeaks(inp([v(10000, 6000)], [
    d('b', 'product', { bps: 5000 }), d('B', 'product', { bps: 5000 }),
  ]));
  assert.deepEqual(stacks(r2), ['B', 'b']);
});
