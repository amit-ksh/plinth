// Test-only reference evaluator ("oracle") for Plinth. Exhaustive, no dependencies.

export type DiscountClass = 'product' | 'order' | 'shipping';
export interface OracleVariant { id: string; price: number; cost: number | null; collections: string[] }
export interface OracleDiscount {
  id: string;
  class: DiscountClass;
  method: 'code' | 'automatic';
  bps: number;
  off: number;
  allVariants: boolean;
  variants: string[];
  collections: string[];
  minSubtotal: number;
  combinesWith: DiscountClass[];
  tags: string[];
  acceptsTags: string[];
  starts: number | null;
  ends: number | null;
  supported: boolean;
}
export interface OracleInput {
  plus: boolean; shippingCost: number; maxQty: number;
  variants: OracleVariant[]; discounts: OracleDiscount[];
}
export interface OracleLeak { variant: string; qty: number; stack: string[]; net: number; cost: number }

const MAX_DISCOUNTS = 18;
const MAX_STACK = 8;
const MAX_CODES = 5;
const EPS = 0.000001;

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function intersects(a: string[], b: string[]): boolean {
  for (const x of a) if (b.includes(x)) return true;
  return false;
}

function intervalsOverlap(a: OracleDiscount, b: OracleDiscount): boolean {
  const lo = Math.max(a.starts === null ? -Infinity : a.starts, b.starts === null ? -Infinity : b.starts);
  const hi = Math.min(a.ends === null ? Infinity : a.ends, b.ends === null ? Infinity : b.ends);
  return lo < hi;
}

export function canCombine(a: OracleDiscount, b: OracleDiscount, plus: boolean): boolean {
  if (a.id === b.id) return false;
  if (!intervalsOverlap(a, b)) return false;
  if (a.class === 'shipping' && b.class === 'shipping') return false;
  if (a.class === 'product' && b.class === 'product') {
    return plus &&
      a.combinesWith.includes('product') && b.combinesWith.includes('product') &&
      intersects(a.acceptsTags, b.tags) && intersects(b.acceptsTags, a.tags);
  }
  return a.combinesWith.includes(b.class) && b.combinesWith.includes(a.class);
}

function applies(d: OracleDiscount, v: OracleVariant): boolean {
  return d.allVariants || d.variants.includes(v.id) || intersects(d.collections, v.collections);
}

export function findLeaks(input: OracleInput): OracleLeak[] {
  const all = input.discounts;
  if (all.length > MAX_DISCOUNTS) {
    throw new Error(`oracle: too many discounts (${all.length} > ${MAX_DISCOUNTS})`);
  }
  const out: OracleLeak[] = [];

  for (const v of input.variants) {
    if (v.cost === null) continue;
    const cost = v.cost;
    const cands = all.filter((d) => d.supported && applies(d, v));
    const n = cands.length;
    for (let mask = 1; mask < (1 << n); mask++) {
      const stack: OracleDiscount[] = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) stack.push(cands[i]);
      if (stack.length > MAX_STACK) continue;
      if (stack.filter((d) => d.method === 'code' && (d.class === 'product' || d.class === 'order')).length > MAX_CODES) continue;
      if (stack.filter((d) => d.class === 'shipping').length > 1) continue;
      let ok = true;
      for (let i = 0; i < stack.length && ok; i++) {
        for (let j = i + 1; j < stack.length; j++) {
          if (!canCombine(stack[i], stack[j], input.plus)) { ok = false; break; }
        }
      }
      if (!ok) continue;
      const hasShipping = stack.some((d) => d.class === 'shipping');
      const ids = stack.map((d) => d.id).sort(cmp);

      for (let qty = 1; qty <= input.maxQty; qty++) {
        const listed = v.price * qty;
        let sub = listed;
        for (const d of stack) if (d.class === 'product') sub = sub * (1 - d.bps / 10000);
        for (const d of stack) if (d.class === 'product') sub = sub - d.off * qty;
        if (sub < 0) sub = 0;

        let valid = true;
        for (const d of stack) {
          if (d.class === 'product') {
            if (!(d.minSubtotal <= listed)) valid = false;
          } else if (!(d.minSubtotal <= sub + EPS)) valid = false;
        }
        if (!valid) continue;

        let orderOff = 0;
        for (const d of stack) if (d.class === 'order') orderOff += sub * d.bps / 10000 + d.off;
        const revenue = Math.max(0, sub - orderOff);
        const net = revenue - (hasShipping ? input.shippingCost : 0);
        const roundedNet = Math.floor(net + 0.5 + EPS);
        if (roundedNet < cost * qty) {
          out.push({ variant: v.id, qty, stack: ids.slice(), net: roundedNet, cost: cost * qty });
        }
      }
    }
  }

  out.sort((a, b) => cmp(a.variant, b.variant) || a.qty - b.qty || cmp(a.stack.join('|'), b.stack.join('|')));
  return out;
}
