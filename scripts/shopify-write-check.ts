// Round-trips discount writes through a real Shopify store: every write is read back through the import
// mapping and compared with what Plinth sent. Creates discounts prefixed PLINTHCHECK and deletes them at the end.
//
//   SHOPIFY_STORE=my-dev-store SHOPIFY_API_KEY=... SHOPIFY_API_SECRET=... npm run shopify:check-writes
//
// Use a development store. The app needs write_discounts, read_products and read_inventory.
import assert from 'node:assert/strict';
import { fromShopify, pullShopify, SHOPIFY_API_VERSION } from '../packages/core/src/shopify.ts';
import { acceptsTagsOf, addRedeemCodes, discountMutation, generateCodes, writeDiscount, type WriteKind } from '../packages/core/src/shopify-write.ts';
import type { Discount } from '../packages/core/src/types.ts';

const shopName = (process.env.SHOPIFY_STORE ?? '').replace(/\.myshopify\.com$/, '');
const shop = `${shopName}.myshopify.com`;
const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.SHOPIFY_API_KEY ?? '', client_secret: process.env.SHOPIFY_API_SECRET ?? '' }),
});
const token = ((await res.json()) as { access_token?: string }).access_token;
if (!token) throw new Error(`No token for ${shop}`);

const request = async (query: string, variables?: Record<string, unknown>) => {
  const r = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  return r.json() as Promise<any>;
};

let current = fromShopify(await pullShopify(request));
const link = () => current.link;
const byTitle = (t: string) => current.store.variants.find((v) => v.title === t)!.id;
const collection = (t: string) => current.store.collections.find((c) => c.title === t)!.id;

async function write(kind: WriteKind, d: Discount, previous: Discount | null): Promise<void> {
  const gid = previous ? link().discounts[previous.id] ?? null : null;
  await writeDiscount(request, kind, d, { previous, gid, link: link(), now: Date.now() });
  current = fromShopify(await pullShopify(request));
}

const strip = (d: Discount) => ({ ...d, starts: null, acceptsTags: acceptsTagsOf(d) });
function expectRead(d: Discount, label: string) {
  const got = current.store.discounts.find((x) => x.id === d.id);
  assert.ok(got, `${label}: ${d.id} not found after write`);
  assert.deepEqual(strip(got), strip(d), label);
  console.log(`ok   ${label}`);
}

// Leftovers from an interrupted run.
for (const d of current.store.discounts.filter((x) => x.id.startsWith('PLINTHCHECK') || x.title === 'Plinth check order')) {
  const m = discountMutation('delete', { ...d, supported: true }, { previous: d, gid: link().discounts[d.id], link: link(), now: Date.now() });
  await request(m.query, m.variables);
}
current = fromShopify(await pullShopify(request));

const base = { method: 'code' as const, bps: 0, off: 0, allVariants: false, variants: [], collections: [], minSubtotal: 0, combinesWith: [], tags: [], acceptsTags: [], starts: null, ends: null, supported: true };

let a: Discount = { ...base, id: 'PLINTHCHECK1', title: 'PLINTHCHECK1', class: 'product', bps: 1500, collections: [collection('Winter')], combinesWith: ['product', 'shipping'], tags: ['check'], acceptsTags: ['vip', 'flash'], minSubtotal: 5000 };
await write('create', a, null);
expectRead(a, 'creates a product discount with tags, accepted tags and a minimum');

let next: Discount = { ...a, bps: 2500, collections: [collection('Footwear')], acceptsTags: ['vip'], minSubtotal: 0, combinesWith: ['order'] };
await write('update', next, a);
a = next;
expectRead(a, 'updates value, collection, accepted tags, minimum and combinations');

next = { ...a, collections: [], variants: [byTitle('Wool cap')] };
await write('update', next, a);
a = next;
expectRead(a, 'switches from a collection to a product');

next = { ...a, ends: Date.now() + 3_600_000 };
await write('update', next, a);
a = { ...next, ends: current.store.discounts.find((d) => d.id === a.id)!.ends };
expectRead(a, 'sets an end date');
next = { ...a, ends: null };
await write('update', next, a);
a = next;
expectRead(a, 'clears the end date');

let b: Discount = { ...base, id: 'PLINTHCHECK2', title: 'Plinth check order', class: 'order', method: 'automatic', off: 1000, allVariants: true, minSubtotal: 10000, combinesWith: ['shipping'] };
await write('create', b, null);
b = { ...b, id: current.store.discounts.find((d) => d.title === 'Plinth check order')!.id };
expectRead(b, 'creates an automatic order discount with a fixed amount');

let c: Discount = { ...base, id: 'PLINTHCHECK3', title: 'PLINTHCHECK3', class: 'shipping', allVariants: true, minSubtotal: 7500, combinesWith: ['product', 'order'] };
await write('create', c, null);
expectRead(c, 'creates a free shipping code with a minimum');
next = { ...c, minSubtotal: 0 };
await write('update', next, c);
c = next;
expectRead(c, 'removes the shipping minimum');

next = { ...c, class: 'order', bps: 1000, combinesWith: [] };
await write('update', next, c);
c = next;
expectRead(c, 'changes free shipping into an order discount by recreating it');

for (const d of [a, b, c]) await write('delete', d, d);
assert.ok(!current.store.discounts.some((d) => d.id.startsWith('PLINTHCHECK') || d.title === 'Plinth check order'), 'test discounts deleted');
console.log('ok   deletes every test discount');

// Bulk codes: added to a real code discount, then read back.
{
  let d: Discount = { ...base, id: 'PLINTHCHECK4', title: 'PLINTHCHECK4', class: 'order', bps: 500, allVariants: true, combinesWith: [] };
  await write('create', d, null);
  const gid = link().discounts[d.id];
  const codes = generateCodes('PLINTHCHECK4', 30);
  assert.equal(new Set(codes).size, 30);
  assert.equal(await addRedeemCodes(request, gid, codes), 30);
  let count = 0;
  for (let i = 0; i < 20 && count < 31; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const body = await request(`query($id: ID!) { codeDiscountNode(id: $id) { codeDiscount { ... on DiscountCodeBasic { codesCount { count } } } } }`, { id: gid });
    count = body.data.codeDiscountNode.codeDiscount.codesCount.count;
  }
  assert.equal(count, 31, 'the original code plus 30 new ones');
  console.log('ok   adds 30 unique codes to a code discount');
  await write('delete', d, d);
}
