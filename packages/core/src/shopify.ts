// Reads a Shopify store through the Admin GraphQL API and maps it to a StoreInput.
// Read-only: needs read_products, read_discounts and read_inventory. No customer data.
// `pullShopify` takes the request function so the Cloudflare Worker and Node scripts share it.
import { CURRENCIES, type Currency } from './format.ts';
import type { Discount, DiscountClass, StoreInput, Variant } from './types.ts';
import { validate } from './validate.ts';

export const SHOPIFY_API_VERSION = '2026-10';
export const SHOPIFY_SCOPES = 'read_products,read_discounts,read_inventory';
/** Stops very large stores before they exhaust a browser tab. */
export const SHOPIFY_MAX_VARIANTS = 20_000;

const SHOP = `{ shop { name myshopifyDomain currencyCode plan { shopifyPlus } } }`;

const PRODUCTS = `query($after: String) {
  products(first: 50, after: $after, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title isGiftCard
      featuredMedia { preview { image { url(transform: { maxWidth: 96, maxHeight: 96 }) } } }
      collections(first: 50) { nodes { id title } }
      variants(first: 100) {
        pageInfo { hasNextPage }
        nodes { id title sku price image { url(transform: { maxWidth: 96, maxHeight: 96 }) } inventoryItem { unitCost { amount } } }
      }
    }
  }
}`;

const COMBINES = `combinesWith { productDiscounts orderDiscounts shippingDiscounts productDiscountsWithTagsOnSameCartLine }`;
const GETS = `customerGets {
  value {
    __typename
    ... on DiscountPercentage { percentage }
    ... on DiscountAmount { amount { amount } appliesOnEachItem }
  }
  items {
    __typename
    ... on AllDiscountItems { allItems }
    ... on DiscountCollections { collections(first: 100) { nodes { id } } }
    ... on DiscountProducts { products(first: 100) { nodes { id } } productVariants(first: 100) { nodes { id } } }
  }
}`;
const MINIMUM = `minimumRequirement {
  __typename
  ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount } }
}`;
const COMMON = `title startsAt endsAt discountClasses ${COMBINES}`;

const DISCOUNTS = `query($after: String) {
  discountNodes(first: 50, after: $after, query: "status:active OR status:scheduled") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      discount {
        __typename
        ... on DiscountCodeBasic { ${COMMON} tags codes(first: 1) { nodes { code } } ${GETS} ${MINIMUM} }
        ... on DiscountAutomaticBasic { ${COMMON} tags ${GETS} ${MINIMUM} }
        ... on DiscountCodeFreeShipping { ${COMMON} codes(first: 1) { nodes { code } } ${MINIMUM} }
        ... on DiscountAutomaticFreeShipping { ${COMMON} ${MINIMUM} }
        ... on DiscountCodeBxgy { ${COMMON} codes(first: 1) { nodes { code } } }
        ... on DiscountAutomaticBxgy { ${COMMON} }
        ... on DiscountCodeApp { ${COMMON} codes(first: 1) { nodes { code } } }
        ... on DiscountAutomaticApp { ${COMMON} }
      }
    }
  }
}`;

export type ShopifyRequest = (query: string, variables?: Record<string, unknown>) => Promise<any>;

/** Raw Shopify data, as returned by pullShopify. Plain JSON, so it can cross the network and a worker. */
export interface ShopifyPull {
  shop: { name: string; myshopifyDomain: string; currencyCode: string; plan: { shopifyPlus: boolean } };
  products: any[];
  discounts: any[];
  truncated: boolean;
}

async function pages(request: ShopifyRequest, query: string, key: string, limit: number): Promise<{ nodes: any[]; truncated: boolean }> {
  const nodes: any[] = [];
  let after: string | null = null;
  for (;;) {
    const body = await request(query, { after });
    if (body.errors?.length) throw new Error(`Shopify: ${body.errors.map((e: any) => e.message).join('; ')}`);
    const page = body.data[key];
    nodes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return { nodes, truncated: false };
    if (nodes.length >= limit) return { nodes, truncated: true };
    after = page.pageInfo.endCursor;
  }
}

export async function pullShopify(request: ShopifyRequest): Promise<ShopifyPull> {
  const shop = await request(SHOP);
  if (shop.errors?.length) throw new Error(`Shopify: ${shop.errors.map((e: any) => e.message).join('; ')}`);
  const products = await pages(request, PRODUCTS, 'products', SHOPIFY_MAX_VARIANTS);
  const discounts = await pages(request, DISCOUNTS, 'discountNodes', 2_000);
  return { shop: shop.data.shop, products: products.nodes, discounts: discounts.nodes, truncated: products.truncated || discounts.truncated };
}

export interface ShopifyImport {
  store: StoreInput;
  storeName: string;
  currency: Currency | null;
  /** Plain-language notes about anything Plinth could not model exactly. */
  notes: string[];
  missingCost: number;
}

const ID = /^[A-Za-z0-9_.:/-]{1,128}$/;
const numeric = (gid: string) => gid.slice(gid.lastIndexOf('/') + 1);
const cents = (amount: string | undefined | null): number | null => {
  if (amount === undefined || amount === null || amount === '') return null;
  const n = Math.round(Number(amount) * 100);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const at = (iso: string | null) => (iso ? Date.parse(iso) : null);

/** Turns a code or title into a unique Plinth ID, keeping it readable where possible. */
function idFor(raw: string, used: Set<string>): string {
  let base = raw.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9_.:/-]/g, '').slice(0, 100) || 'discount';
  if (!ID.test(base)) base = 'discount';
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

export function fromShopify(pull: ShopifyPull): ShopifyImport {
  const notes: string[] = [];
  const collections = new Map<string, string>();
  const variants: Variant[] = [];
  const variantsOf = new Map<string, string[]>();
  const usedVariant = new Set<string>();
  let splitProducts = 0;

  let giftCards = 0;
  const products = pull.products.filter((p) => !(p.isGiftCard && ++giftCards));
  for (const p of products) {
    for (const c of p.collections.nodes) collections.set(`c${numeric(c.id)}`, c.title);
    if (p.variants.pageInfo?.hasNextPage) splitProducts++;
    const productImage = p.featuredMedia?.preview?.image?.url;
    const ids: string[] = [];
    for (const v of p.variants.nodes) {
      const sku = typeof v.sku === 'string' ? v.sku.trim() : '';
      const id = sku && ID.test(sku) && !usedVariant.has(sku) ? sku : `v${numeric(v.id)}`;
      usedVariant.add(id);
      ids.push(id);
      const image = v.image?.url ?? productImage;
      variants.push({
        id,
        title: (v.title && v.title !== 'Default Title' ? `${p.title} – ${v.title}` : p.title).slice(0, 500),
        price: cents(v.price) ?? 0,
        cost: cents(v.inventoryItem?.unitCost?.amount),
        collections: p.collections.nodes.map((c: any) => `c${numeric(c.id)}`),
        ...(typeof image === 'string' && image.startsWith('https://') && image.length <= 500 ? { image } : {}),
      });
    }
    variantsOf.set(p.id, ids);
  }
  const variantIdByGid = new Map<string, string>();
  for (const p of products) p.variants.nodes.forEach((v: any, i: number) => variantIdByGid.set(v.id, variantsOf.get(p.id)![i]));

  const usedDiscount = new Set<string>();
  const discounts: Discount[] = [];
  const unsupportedKinds = new Map<string, number>();
  const unsupported = (why: string) => unsupportedKinds.set(why, (unsupportedKinds.get(why) ?? 0) + 1);

  for (const node of pull.discounts) {
    const d = node.discount;
    if (!d) continue;
    const code: string | undefined = d.codes?.nodes?.[0]?.code;
    const classes: DiscountClass[] = (d.discountClasses ?? []).map((c: string) => c.toLowerCase()).filter((c: string) => c === 'product' || c === 'order' || c === 'shipping');
    const cls: DiscountClass = classes[0] ?? (d.__typename.includes('FreeShipping') ? 'shipping' : 'product');
    const cw = d.combinesWith ?? {};
    const out: Discount = {
      id: idFor(code ?? d.title, usedDiscount),
      title: String(d.title ?? code ?? 'Discount').slice(0, 500),
      class: cls,
      method: code ? 'code' : 'automatic',
      bps: 0,
      off: 0,
      allVariants: false,
      variants: [],
      collections: [],
      minSubtotal: 0,
      combinesWith: [
        ...(cw.productDiscounts ? ['product' as const] : []),
        ...(cw.orderDiscounts ? ['order' as const] : []),
        ...(cw.shippingDiscounts ? ['shipping' as const] : []),
      ],
      tags: Array.isArray(d.tags) ? d.tags.filter((t: unknown) => typeof t === 'string') : [],
      acceptsTags: Array.isArray(cw.productDiscountsWithTagsOnSameCartLine) ? cw.productDiscountsWithTagsOnSameCartLine.filter((t: unknown) => typeof t === 'string') : [],
      starts: at(d.startsAt),
      ends: at(d.endsAt),
      supported: true,
    };
    const fail = (why: string) => {
      out.supported = false;
      out.allVariants = true;
      unsupported(why);
    };

    if (classes.length > 1) fail('apply to more than one class');
    else if (d.__typename.includes('Bxgy')) fail('are Buy X Get Y');
    else if (d.__typename.includes('App')) fail('come from other apps');
    else if (d.__typename.includes('FreeShipping')) out.allVariants = true;
    else {
      const value = d.customerGets?.value;
      if (value?.__typename === 'DiscountPercentage') out.bps = Math.round(value.percentage * 10000);
      else if (value?.__typename === 'DiscountAmount') {
        out.off = cents(value.amount?.amount) ?? 0;
        if (cls === 'product' && !value.appliesOnEachItem) fail('spread one fixed amount across items');
      } else fail('use a value Plinth doesn’t model');

      const items = d.customerGets?.items;
      if (items?.__typename === 'AllDiscountItems' || cls === 'order') out.allVariants = true;
      else if (items?.__typename === 'DiscountCollections') out.collections = items.collections.nodes.map((c: any) => `c${numeric(c.id)}`);
      else if (items?.__typename === 'DiscountProducts') {
        const ids = new Set<string>();
        for (const p of items.products.nodes) for (const id of variantsOf.get(p.id) ?? []) ids.add(id);
        for (const v of items.productVariants.nodes) {
          const id = variantIdByGid.get(v.id);
          if (id) ids.add(id);
        }
        out.variants = [...ids];
      }
    }
    if (d.minimumRequirement?.__typename === 'DiscountMinimumSubtotal') out.minSubtotal = cents(d.minimumRequirement.greaterThanOrEqualToSubtotal?.amount) ?? 0;
    else if (d.minimumRequirement) fail('need a minimum quantity');

    // Targets outside the imported products (drafts, archived) are dropped; a discount left with none is skipped.
    out.collections = out.collections.filter((c) => collections.has(c));
    if (out.supported && !out.allVariants && !out.variants.length && !out.collections.length) continue;
    discounts.push(out);
  }

  // Collections that only discounts referenced, and that have no imported product, still need a node.
  const store: StoreInput = {
    plus: Boolean(pull.shop.plan?.shopifyPlus),
    collections: [...collections].map(([id, title]) => ({ id, title: String(title).slice(0, 500) })),
    variants,
    discounts,
  };

  if (!store.plus) notes.push('This store isn’t on Shopify Plus, so product discounts never stack on the same item.');
  for (const [why, n] of unsupportedKinds) notes.push(`${n} ${n === 1 ? 'discount' : 'discounts'} ${why}, so results that involve ${n === 1 ? 'it' : 'them'} say Can’t be sure.`);
  if (giftCards) notes.push(`${giftCards} gift ${giftCards === 1 ? 'card was' : 'cards were'} skipped, because discounts don’t apply to gift cards.`);
  if (splitProducts) notes.push(`${splitProducts} ${splitProducts === 1 ? 'product has' : 'products have'} more than 100 variants. Only the first 100 were read.`);
  if (pull.truncated) notes.push(`Only the first ${SHOPIFY_MAX_VARIANTS.toLocaleString('en')} products or 2,000 discounts were read.`);
  notes.push('Customer eligibility is ignored: every discount is assumed available to every buyer, the worst case.');

  validate(store);
  const currency = (CURRENCIES as readonly string[]).includes(pull.shop.currencyCode) ? (pull.shop.currencyCode as Currency) : null;
  if (!currency) notes.push(`The store sells in ${pull.shop.currencyCode}, which Plinth can’t format yet. Amounts are shown in your chosen currency.`);
  return { store, storeName: String(pull.shop.name).slice(0, 80) || 'My store', currency, notes, missingCost: variants.filter((v) => v.cost === null).length };
}
