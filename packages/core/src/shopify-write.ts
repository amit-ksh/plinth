// Builds the Admin GraphQL mutation that writes one Plinth discount to Shopify.
// Only data goes into variables; the query text is fixed per discount type, so nothing user-typed becomes GraphQL.
import type { ShopifyLink } from './app-state.ts';
import type { Discount } from './types.ts';
import { InputError } from './validate.ts';

export type WriteKind = 'create' | 'update' | 'delete';

export interface ShopifyMutation {
  query: string;
  variables: Record<string, unknown>;
  /** Where the result object sits under `data`. */
  field: string;
  /** Under the result: the node holding the new or updated ID, if any. */
  node: string | null;
}

type Family = 'codeBasic' | 'automaticBasic' | 'codeShipping' | 'automaticShipping';

export const familyOf = (d: Discount): Family =>
  d.class === 'shipping' ? (d.method === 'code' ? 'codeShipping' : 'automaticShipping') : d.method === 'code' ? 'codeBasic' : 'automaticBasic';

const MUTATION: Record<Family, { create: [string, string]; update: [string, string]; node: string; inputType: string }> = {
  codeBasic: { create: ['discountCodeBasicCreate', 'basicCodeDiscount'], update: ['discountCodeBasicUpdate', 'basicCodeDiscount'], node: 'codeDiscountNode', inputType: 'DiscountCodeBasicInput' },
  automaticBasic: { create: ['discountAutomaticBasicCreate', 'automaticBasicDiscount'], update: ['discountAutomaticBasicUpdate', 'automaticBasicDiscount'], node: 'automaticDiscountNode', inputType: 'DiscountAutomaticBasicInput' },
  codeShipping: { create: ['discountCodeFreeShippingCreate', 'freeShippingCodeDiscount'], update: ['discountCodeFreeShippingUpdate', 'freeShippingCodeDiscount'], node: 'codeDiscountNode', inputType: 'DiscountCodeFreeShippingInput' },
  automaticShipping: { create: ['discountAutomaticFreeShippingCreate', 'freeShippingAutomaticDiscount'], update: ['discountAutomaticFreeShippingUpdate', 'freeShippingAutomaticDiscount'], node: 'automaticDiscountNode', inputType: 'DiscountAutomaticFreeShippingInput' },
};

/** The tags a discount accepts, as Shopify stores them: none unless it combines with product discounts. */
export const acceptsTagsOf = (d: Discount) => (d.class === 'product' && d.combinesWith.includes('product') ? d.acceptsTags : []);

const dollars = (minor: number) => (minor / 100).toFixed(2);
const iso = (ms: number) => new Date(ms).toISOString();

function gidsFor(ids: string[], map: Record<string, string>, what: string): string[] {
  const missing = ids.filter((id) => !map[id]);
  if (missing.length) throw new InputError([`${missing.slice(0, 3).join(', ')} ${missing.length === 1 ? 'isn’t' : 'aren’t'} in Shopify, so this ${what} can’t be saved there. Refresh from Shopify and try again`]);
  return ids.map((id) => map[id]);
}

function input(d: Discount, previous: Discount | null, link: ShopifyLink, now: number, creating: boolean): Record<string, unknown> {
  const family = familyOf(d);
  const shipping = family === 'codeShipping' || family === 'automaticShipping';
  const tagsBefore = previous && previous.class === 'product' ? previous.acceptsTags : [];
  const out: Record<string, unknown> = {
    title: d.title || d.id,
    startsAt: iso(d.starts ?? (creating ? now : previous?.starts ?? now)),
    endsAt: d.ends === null ? null : iso(d.ends),
    combinesWith: {
      productDiscounts: d.combinesWith.includes('product'),
      orderDiscounts: d.combinesWith.includes('order'),
      shippingDiscounts: d.combinesWith.includes('shipping'),
      // Shopify accepts tags only on product discounts that combine with product discounts.
      ...(d.class === 'product'
        ? { productDiscountsWithTagsOnSameCartLine: { add: acceptsTagsOf(d), remove: tagsBefore.filter((t) => !acceptsTagsOf(d).includes(t)) } }
        : {}),
    },
    minimumRequirement: d.minSubtotal ? { subtotal: { greaterThanOrEqualToSubtotal: dollars(d.minSubtotal) } } : creating ? null : { subtotal: { greaterThanOrEqualToSubtotal: null } },
  };
  if (d.method === 'code') out.code = d.id;
  if (creating) out.context = { all: 'ALL' };
  if (shipping) {
    if (creating) out.destination = { all: true };
    return out;
  }
  out.tags = d.class === 'product' ? d.tags : [];

  const value = d.bps
    ? { percentage: d.bps / 10000 }
    : { discountAmount: { amount: dollars(d.off), appliesOnEachItem: d.class === 'product' } };
  let items: Record<string, unknown>;
  if (d.allVariants || d.class === 'order') items = { all: true };
  else if (d.collections.length && !d.variants.length) {
    const before = previous && !previous.allVariants ? previous.collections : [];
    items = {
      collections: {
        add: gidsFor(d.collections, link.collections, 'discount'),
        remove: gidsFor(before.filter((c) => !d.collections.includes(c) && link.collections[c]), link.collections, 'discount'),
      },
    };
  } else if (d.variants.length && !d.collections.length) {
    const before = previous && !previous.allVariants ? previous.variants : [];
    items = {
      products: {
        productVariantsToAdd: gidsFor(d.variants, link.variants, 'discount'),
        productVariantsToRemove: gidsFor(before.filter((v) => !d.variants.includes(v) && link.variants[v]), link.variants, 'discount'),
      },
    };
  } else throw new InputError(['Shopify applies a discount to collections or to products, not both. Choose one']);
  out.customerGets = { value, items };
  return out;
}

/**
 * The mutation for one write. An update that changes the discount's type (code or automatic,
 * shipping or not) can't be done in place in Shopify: callers create the new one, then delete the old.
 */
export function discountMutation(kind: WriteKind, d: Discount, opts: { previous: Discount | null; gid: string | null; link: ShopifyLink; now: number }): ShopifyMutation {
  if (!d.supported) throw new InputError(['Plinth doesn’t model this kind of discount, so edit it in Shopify']);
  const family = familyOf(d);
  if (kind === 'delete') {
    if (!opts.gid) throw new InputError(['This discount isn’t in Shopify']);
    const field = opts.gid.includes('/DiscountAutomaticNode/') ? 'discountAutomaticDelete' : 'discountCodeDelete';
    return { query: `mutation($id: ID!) { ${field}(id: $id) { userErrors { field message } } }`, variables: { id: opts.gid }, field, node: null };
  }
  const m = MUTATION[family];
  if (kind === 'update') {
    if (!opts.gid) throw new InputError(['This discount isn’t in Shopify yet']);
    const [field, arg] = m.update;
    return {
      query: `mutation($id: ID!, $input: ${m.inputType}!) { ${field}(id: $id, ${arg}: $input) { ${m.node} { id } userErrors { field message } } }`,
      variables: { id: opts.gid, input: input(d, opts.previous, opts.link, opts.now, false) },
      field,
      node: m.node,
    };
  }
  const [field, arg] = m.create;
  return {
    query: `mutation($input: ${m.inputType}!) { ${field}(${arg}: $input) { ${m.node} { id } userErrors { field message } } }`,
    variables: { input: input(d, null, opts.link, opts.now, true) },
    field,
    node: m.node,
  };
}

const targetKind = (d: Discount) => (d.allVariants || d.class === 'order' ? 'all' : d.collections.length ? 'collections' : 'products');

/**
 * Every mutation for one write, in order. Shopify won't move a discount between collections and products
 * in one update, so that switch first widens it to all products, then narrows it to the new target.
 */
export function discountMutations(kind: WriteKind, d: Discount, opts: { previous: Discount | null; gid: string | null; link: ShopifyLink; now: number }): ShopifyMutation[] {
  const { previous } = opts;
  if (kind === 'update' && previous && d.class !== 'shipping' && targetKind(previous) !== 'all' && targetKind(d) !== 'all' && targetKind(previous) !== targetKind(d)) {
    const widened: Discount = { ...previous, ...d, allVariants: true, collections: [], variants: [] };
    return [discountMutation('update', widened, opts), discountMutation('update', d, { ...opts, previous: widened })];
  }
  return [discountMutation(kind, d, opts)];
}

/** True when Shopify can't change the discount in place and it has to be recreated. */
export const needsRecreate = (d: Discount, previous: Discount) => familyOf(d) !== familyOf(previous);

export type GraphqlRequest = (query: string, variables?: Record<string, unknown>) => Promise<any>;

async function run(request: GraphqlRequest, m: ShopifyMutation): Promise<string | null> {
  const body = await request(m.query, m.variables);
  if (body?.errors?.length) throw new InputError([`Shopify refused the change: ${body.errors.map((e: any) => e.message).join('; ')}`]);
  const result = body?.data?.[m.field];
  const errors: { message: string }[] = result?.userErrors ?? [];
  if (errors.length) throw new InputError(errors.map((e) => `Shopify: ${e.message}`));
  return m.node ? result?.[m.node]?.id ?? null : null;
}

/**
 * Writes one change to Shopify and returns the discount's Shopify ID afterwards (null after a delete).
 * A change of type is a delete then a create; if the create fails, the old discount is put back.
 */
export async function writeDiscount(
  request: GraphqlRequest,
  kind: WriteKind,
  d: Discount,
  opts: { previous: Discount | null; gid: string | null; link: ShopifyLink; now: number },
): Promise<string | null> {
  if (kind === 'update' && opts.previous && needsRecreate(d, opts.previous)) {
    await run(request, discountMutation('delete', opts.previous, opts));
    try {
      return await run(request, discountMutation('create', d, { ...opts, previous: null, gid: null }));
    } catch (error) {
      await run(request, discountMutation('create', opts.previous, { ...opts, previous: null, gid: null })).catch(() => null);
      throw error;
    }
  }
  let gid = opts.gid;
  for (const m of discountMutations(kind, d, opts)) gid = (await run(request, m)) ?? (kind === 'delete' ? null : gid);
  return kind === 'delete' ? null : gid;
}
