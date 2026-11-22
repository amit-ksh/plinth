import type { Change } from './fixes.ts';
import type { UnknownReason } from './types.ts';

export const CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'AUD', 'CAD'] as const;
export type Currency = (typeof CURRENCIES)[number];

const formatters = new Map<Currency, Intl.NumberFormat>();

/** Formats minor units, with a true minus sign. */
export function formatMoney(minor: number, currency: Currency): string {
  let format = formatters.get(currency);
  if (!format) {
    format = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency });
    formatters.set(currency, format);
  }
  return format.format(minor / 100).replace('-', '−');
}

/** Reads "1,250.50" as 125050 without going through a float. Null when it is not an amount. */
export function parseMoney(text: string): number | null {
  const match = /^(?:[$€£₹]\s*)?((?:\d{1,3}(?:,\d{2,3})+)|\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1].replaceAll(',', '') + (match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(value) ? value : null;
}

/** Reads "12.5" or "12.5%" as 1250 basis points. */
export function parsePercent(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?\s*%?$/.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return value <= 10000 ? value : null;
}

export function describeChange(change: Change): { title: string; setting: string } {
  if (change.kind === 'end') {
    return { title: `End ${change.discount}`, setting: `Discounts → ${change.discount} → Deactivate` };
  }
  if (change.kind === 'class') {
    return {
      title: `Stop ${change.discount} combining with ${change.value} discounts`,
      setting: `Discounts → ${change.discount} → Combinations → untick ${change.value} discounts`,
    };
  }
  return {
    title: `Stop ${change.discount} stacking with “${change.value}” discounts`,
    setting: `Discounts → ${change.discount} → Combinations → remove the tag “${change.value}”`,
  };
}

export const UNKNOWN_TEXT: Record<UnknownReason, string> = {
  missing_cost: 'It has no cost, so a loss can’t be ruled out.',
  unsupported_discount: 'A discount that applies to it isn’t modeled yet.',
  search_incomplete: 'Too many discounts can stack on it to check them all.',
};
