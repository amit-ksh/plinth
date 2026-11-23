// Results from a real Shopify Plus development store, recorded on 2026-11-23.
// The sample store's products and discounts were recreated there, and each cart was priced by the
// Storefront API (the engine checkout uses). Totals exclude shipping and tax: carts don't price delivery.
// `applied` and `rejected` are the codes Shopify reported as applicable or not.

export interface GoldenCart {
  name: string;
  variant: string;
  qty: number;
  codes: string[];
  applied: string[];
  rejected: string[];
  /** Merchandise total after discounts, in cents. */
  total: number;
}

export const SHOPIFY_GOLDEN: GoldenCart[] = [
  { name: 'jacket: three classes stack', variant: 'jacket', qty: 1, codes: ['BUNDLE20', 'WELCOME15', 'FREESHIP'], applied: ['BUNDLE20', 'WELCOME15', 'FREESHIP'], rejected: [], total: 6800 },
  { name: 'jacket: product then order', variant: 'jacket', qty: 1, codes: ['BUNDLE20', 'WELCOME15'], applied: ['BUNDLE20', 'WELCOME15'], rejected: [], total: 6800 },
  { name: 'boots: same line, tags match', variant: 'boots', qty: 1, codes: ['BOOT20', 'VIP25'], applied: ['BOOT20', 'VIP25'], rejected: [], total: 6000 },
  { name: 'boots: same line, other pair', variant: 'boots', qty: 1, codes: ['VIP25', 'FLASH10'], applied: ['VIP25', 'FLASH10'], rejected: [], total: 6750 },
  { name: 'boots: tags one way only', variant: 'boots', qty: 1, codes: ['BOOT20', 'FLASH10'], applied: ['BOOT20'], rejected: ['FLASH10'], total: 8000 },
  { name: 'boots: best valid pair of three', variant: 'boots', qty: 1, codes: ['BOOT20', 'VIP25', 'FLASH10'], applied: ['BOOT20', 'VIP25'], rejected: ['FLASH10'], total: 6000 },
  { name: 'boots: product pair without tags', variant: 'boots', qty: 1, codes: ['BOOT20', 'SOCKS2'], applied: ['BOOT20'], rejected: ['SOCKS2'], total: 8000 },
  { name: 'cap: discount that combines with nothing', variant: 'wool-cap', qty: 1, codes: ['EXTRAS10', 'WELCOME15'], applied: ['WELCOME15'], rejected: ['EXTRAS10'], total: 2550 },
  { name: 'knitwear: product and order both allow each other', variant: 'knitwear-1', qty: 1, codes: ['KNIT10', 'WELCOME15'], applied: ['KNIT10', 'WELCOME15'], rejected: [], total: 4590 },
  { name: 'gift box: product does not allow order', variant: 'gift-box', qty: 1, codes: ['HOME15', 'WELCOME15'], applied: ['WELCOME15'], rejected: ['HOME15'], total: 3825 },
  { name: 'jacket x3', variant: 'jacket', qty: 3, codes: ['BUNDLE20', 'WELCOME15'], applied: ['BUNDLE20', 'WELCOME15'], rejected: [], total: 20400 },
  { name: 'boots x3', variant: 'boots', qty: 3, codes: ['BOOT20', 'VIP25', 'SOCKS2'], applied: ['BOOT20', 'VIP25'], rejected: ['SOCKS2'], total: 18000 },
  { name: 'gift box x2: product and shipping', variant: 'gift-box', qty: 2, codes: ['HOME15', 'FREESHIP'], applied: ['HOME15', 'FREESHIP'], rejected: [], total: 7650 },
];
