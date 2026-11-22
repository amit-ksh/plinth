import type { Discount, StoreInput, Variant } from './types.ts';

// Synthetic. No real merchant, product or customer data.
const base: Omit<Discount, 'id' | 'title' | 'class'> = {
  method: 'code', bps: 0, off: 0, allVariants: false, variants: [], collections: [], minSubtotal: 0,
  combinesWith: [], tags: [], acceptsTags: [], starts: null, ends: null, supported: true,
};

const families = [
  ['winter', 'Winter'],
  ['footwear', 'Footwear'],
  ['knitwear', 'Knitwear'],
  ['home', 'Home'],
  ['accessories', 'Accessories'],
] as const;

const featured: Variant[] = [
  { id: 'jacket', title: 'Winter jacket', price: 10000, cost: 6500, collections: ['winter'] },
  { id: 'boots', title: 'Leather boots', price: 10000, cost: 6200, collections: ['footwear'] },
  { id: 'gift-box', title: 'Gift box', price: 4500, cost: null, collections: ['home'] },
  { id: 'wool-cap', title: 'Wool cap', price: 3000, cost: 1000, collections: ['accessories'] },
];

const others: Variant[] = Array.from({ length: 46 }, (_, i) => {
  const [id, title] = families[i % families.length];
  const price = 4000 + (i % 9) * 1000;
  const number = Math.floor(i / families.length) + 1;
  return { id: `${id}-${number}`, title: `${title} item ${number}`, price, cost: price / 4, collections: [id] };
});

export const SAMPLE_SCENARIO = { shippingCost: 800, maxQty: 3 } as const;

export const SAMPLE_STORE: StoreInput = {
  plus: true,
  collections: families.map(([id, title]) => ({ id, title })),
  variants: [...featured, ...others],
  discounts: [
    { ...base, id: 'BUNDLE20', title: '20% off winter', class: 'product', bps: 2000, collections: ['winter'], combinesWith: ['order', 'shipping'] },
    { ...base, id: 'WELCOME15', title: '15% welcome', class: 'order', bps: 1500, allVariants: true, combinesWith: ['product', 'shipping'] },
    { ...base, id: 'FREESHIP', title: 'Free shipping over $50', class: 'shipping', allVariants: true, minSubtotal: 5000, combinesWith: ['product', 'order'] },
    { ...base, id: 'BOOT20', title: '20% off boots', class: 'product', bps: 2000, variants: ['boots'], combinesWith: ['product'], tags: ['boots'], acceptsTags: ['vip'] },
    { ...base, id: 'VIP25', title: '25% VIP', class: 'product', bps: 2500, variants: ['boots'], combinesWith: ['product'], tags: ['vip'], acceptsTags: ['boots', 'flash'] },
    { ...base, id: 'FLASH10', title: '10% flash sale', class: 'product', bps: 1000, variants: ['boots'], combinesWith: ['product'], tags: ['flash'], acceptsTags: ['vip'] },
    { ...base, id: 'KNIT10', title: '10% off knitwear', class: 'product', bps: 1000, collections: ['knitwear'], combinesWith: ['order'] },
    { ...base, id: 'HOME15', title: '15% off home', class: 'product', bps: 1500, collections: ['home'], combinesWith: ['shipping'] },
    { ...base, id: 'EXTRAS10', title: '10% off accessories', class: 'product', bps: 1000, collections: ['accessories'] },
    { ...base, id: 'LOYAL5', title: '5% loyalty', class: 'order', method: 'automatic', bps: 500, collections: ['knitwear'], combinesWith: ['product'] },
    { ...base, id: 'TAKE5', title: '$5 off accessories', class: 'order', off: 500, collections: ['accessories'], minSubtotal: 5000 },
    { ...base, id: 'SOCKS2', title: '$2 off footwear', class: 'product', off: 200, collections: ['footwear'] },
  ],
};
