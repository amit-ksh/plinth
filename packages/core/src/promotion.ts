import { parseMoney, parsePercent } from './format.ts';
import type { Discount, DiscountClass, StoreInput } from './types.ts';

export type PromotionParse =
  | { ok: true; discount: Discount; /** False when no product or collection was recognized. */ matchedScope: boolean }
  | { ok: false; error: string };

const IGNORED = new Set([
  'off', 'the', 'for', 'and', 'all', 'item', 'items', 'product', 'products', 'discount', 'discounts', 'code',
  'combines', 'combine', 'with', 'order', 'orders', 'cart', 'free', 'shipping', 'new', 'sale', 'on', 'over',
  'above', 'customers', 'customer',
]);

const words = (text: string) => text.toLowerCase().match(/[a-z]{3,}/g)?.filter((w) => !IGNORED.has(w)) ?? [];

/**
 * A deterministic first guess from plain text. The user sees every field and can change it.
 * It assumes the widest stacking, because a check should over-warn before it under-warns.
 */
export function parsePromotion(text: string, store: StoreInput): PromotionParse {
  const input = text.trim();
  if (!input) return { ok: false, error: 'Describe the promotion, for example “20% off winter”.' };
  if (/\bbogo\b|\bbuy\s+(\d+|one|two|x)\b.*\bget\b/i.test(input)) {
    return { ok: false, error: 'Buy X, get Y isn’t supported yet. Enter a percentage, an amount off or free shipping.' };
  }

  const named = /^([A-Za-z0-9][A-Za-z0-9_-]{1,31})\s*:/.exec(input);
  const body = (named ? input.slice(named[0].length) : input).trim();

  const freeShipping = /\bfree\s+(shipping|delivery)\b/i.test(body);
  const percent = /(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|percent\b)/i.exec(body);
  const amount =
    /[$€£₹]\s*(\d[\d,]*(?:\.\d{1,2})?)\s*off\b/i.exec(body) ?? /\b(\d[\d,]*(?:\.\d{1,2})?)\s+off\b/i.exec(body);
  const threshold = /\b(?:over|above|minimum(?: of)?)\s*[$€£₹]?\s*(\d[\d,]*(?:\.\d{1,2})?)/i.exec(body);

  const bps = !freeShipping && percent ? parsePercent(percent[1]) : 0;
  const off = !freeShipping && !percent && amount ? parseMoney(amount[1]) : 0;
  const minSubtotal = threshold ? parseMoney(threshold[1]) : 0;
  if (bps === null) return { ok: false, error: 'Use a percentage from 0 to 100.' };
  if (off === null || minSubtotal === null) return { ok: false, error: 'Write amounts like 500 or 49.99.' };
  if (!freeShipping && !bps && !off) {
    return { ok: false, error: 'Add how much it takes off, for example “20% off”, “$10 off” or “free shipping”.' };
  }

  const said = new Set(words(body));
  let collections = store.collections.filter((c) => words(c.title).some((w) => said.has(w))).map((c) => c.id);
  let variants: string[] = [];

  // A product named in full beats a collection that happens to share a word with it.
  const exact = store.variants.filter((v) => body.toLowerCase().includes(v.title.toLowerCase()));
  if (exact.length) {
    collections = [];
    variants = exact.map((v) => v.id);
  } else if (!collections.length) {
    variants = store.variants.filter((v) => words(v.title).some((w) => said.has(w))).map((v) => v.id);
  }
  const matchedScope = collections.length > 0 || variants.length > 0;

  const orderWide = /\b(order|cart|everything|storewide|sitewide|store-wide|site-wide)\b/i.test(body);
  const cls: DiscountClass = freeShipping ? 'shipping' : orderWide || !matchedScope ? 'order' : 'product';

  const taken = new Set(store.discounts.map((d) => d.id));
  let id = named ? named[1].toUpperCase() : 'NEW-PROMO';
  if (!named) for (let n = 2; taken.has(id); n++) id = `NEW-PROMO-${n}`;

  const tags = [...new Set(store.discounts.flatMap((d) => [...d.tags, ...d.acceptsTags]))].sort();

  return {
    ok: true,
    matchedScope,
    discount: {
      id,
      title: body.slice(0, 120),
      class: cls,
      method: /\bautomatic\b/i.test(body) ? 'automatic' : 'code',
      bps,
      off,
      allVariants: !matchedScope,
      variants,
      collections,
      minSubtotal,
      combinesWith: ['product', 'order', 'shipping'],
      tags: cls === 'product' ? tags : [],
      acceptsTags: cls === 'product' ? tags : [],
      starts: null,
      ends: null,
      supported: true,
    },
  };
}
