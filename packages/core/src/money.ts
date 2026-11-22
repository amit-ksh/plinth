import type { DiscountClass } from './types.ts';

export interface ReceiptLine {
  label: string;
  kind: 'price' | DiscountClass;
  amount: number;
}

export interface Priced {
  class: DiscountClass;
  bps: number;
  off: number;
  minSubtotal: number;
}

const FULL = 10000n;

/**
 * Net revenue in minor units, or null when a threshold is not met.
 *
 * Exact integer arithmetic over the modeled rules, which are not yet confirmed against a Shopify
 * checkout (D6, D7, D10): product percentages compound, then per-unit amounts come off, then
 * order discounts share that subtotal. Halves round up.
 */
export function netRevenue(stack: readonly Priced[], price: number, qty: number, shippingCost: number): number | null {
  const listed = BigInt(price) * BigInt(qty);
  let top = listed;
  let scale = 1n;
  let fixed = 0n;
  let orderBps = 0n;
  let orderOff = 0n;
  let shipping = 0n;

  for (const d of stack) {
    if (d.class === 'product') {
      if (BigInt(d.minSubtotal) > listed) return null;
      if (d.bps) {
        top *= FULL - BigInt(d.bps);
        scale *= FULL;
      }
      fixed += BigInt(d.off) * BigInt(qty);
    } else if (d.class === 'order') {
      orderBps += BigInt(d.bps);
      orderOff += BigInt(d.off);
    } else {
      shipping = BigInt(shippingCost);
    }
  }

  top -= fixed * scale;
  if (top < 0n) top = 0n;
  for (const d of stack) {
    if (d.class !== 'product' && BigInt(d.minSubtotal) * scale > top) return null;
  }

  let revenue = top * (FULL - orderBps) - orderOff * scale * FULL;
  if (revenue < 0n) revenue = 0n;

  const denominator = scale * FULL;
  const doubled = 2n * (revenue - shipping * denominator) + denominator;
  const divisor = 2n * denominator;
  let rounded = doubled / divisor;
  if (doubled < 0n && doubled % divisor !== 0n) rounded -= 1n; // BigInt division truncates toward zero
  return Number(rounded);
}

/** One line per discount, in the order it applies. The lines always add up to the net. */
export function breakdown(
  stack: readonly (Priced & { id: string })[],
  price: number,
  qty: number,
  shippingCost: number,
): ReceiptLine[] {
  const order = { product: 0, order: 1, shipping: 2 };
  const sorted = [...stack].sort((a, b) => order[a.class] - order[b.class]);
  const lines: ReceiptLine[] = [{ label: qty === 1 ? 'Price' : `Price × ${qty}`, kind: 'price', amount: price * qty }];
  const applied: Priced[] = [];
  let before = price * qty;
  for (const d of sorted) {
    // The stack already met its thresholds, so prefixes are priced without them.
    applied.push({ class: d.class, bps: d.bps, off: d.off, minSubtotal: 0 });
    const after = netRevenue(applied, price, qty, shippingCost)!;
    lines.push({ label: d.id, kind: d.class, amount: after - before });
    before = after;
  }
  return lines;
}
