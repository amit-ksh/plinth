import type { DiscountClass } from './types.ts';

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
