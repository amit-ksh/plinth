// Starting points for common promotions. Each one sets combination rules that keep it from stacking
// into a loss by itself, and says why. The guard still checks the result against the real store.
import type { Discount, StoreInput } from './types.ts';

export interface Template {
  id: string;
  name: string;
  /** What it is for, in one line. */
  use: string;
  /** Why its combination settings are what they are. */
  why: string;
  build: (store: StoreInput) => Discount;
}

const base: Omit<Discount, 'id' | 'title' | 'class'> = {
  method: 'code', bps: 0, off: 0, allVariants: false, variants: [], collections: [], minSubtotal: 0,
  combinesWith: [], tags: [], acceptsTags: [], starts: null, ends: null, supported: true,
};

/** A code that isn't taken yet: SALE25, then SALE25-2, and so on. */
export function freeCode(store: StoreInput, code: string): string {
  const taken = new Set(store.discounts.map((d) => d.id));
  let id = code;
  for (let n = 2; taken.has(id); n++) id = `${code}-${n}`;
  return id;
}

const firstCollection = (store: StoreInput) => (store.collections[0] ? { collections: [store.collections[0].id] } : { allVariants: true });

export const TEMPLATES: Template[] = [
  {
    id: 'sitewide',
    name: 'Sitewide sale',
    use: 'A percentage off every order, for Black Friday or a seasonal sale.',
    why: 'Combines with free shipping only, so welcome codes and product discounts can’t stack on top of it.',
    build: (store) => ({ ...base, id: freeCode(store, 'SALE25'), title: 'Sitewide sale', class: 'order', bps: 2500, allVariants: true, combinesWith: ['shipping'] }),
  },
  {
    id: 'collection',
    name: 'Collection sale',
    use: 'A percentage off one collection, like winter or new arrivals.',
    why: 'Combines with free shipping only, so it can’t be added to another product discount or an order code.',
    build: (store) => ({ ...base, id: freeCode(store, 'COLLECTION20'), title: 'Collection sale', class: 'product', bps: 2000, ...firstCollection(store), combinesWith: ['shipping'] }),
  },
  {
    id: 'welcome',
    name: 'Welcome code',
    use: 'A one-time code for new subscribers.',
    why: 'Combines with free shipping only, so a new customer can’t put it on top of a sale.',
    build: (store) => ({ ...base, id: freeCode(store, 'WELCOME10'), title: 'Welcome code', class: 'order', bps: 1000, allVariants: true, combinesWith: ['shipping'] }),
  },
  {
    id: 'vip',
    name: 'VIP extra',
    use: 'An extra percentage for loyal customers.',
    why: 'Tagged vip and accepts no other product discount on the same item. Add tags only for offers you mean to stack.',
    build: (store) => ({ ...base, id: freeCode(store, 'VIP15'), title: 'VIP extra', class: 'product', bps: 1500, allVariants: true, combinesWith: ['shipping'], tags: ['vip'] }),
  },
  {
    id: 'spend',
    name: 'Spend more, save',
    use: 'A fixed amount off orders over a minimum.',
    why: 'The minimum keeps the amount small next to the order, and it combines with free shipping only.',
    build: (store) => ({ ...base, id: freeCode(store, 'SAVE10'), title: 'Spend more, save', class: 'order', off: 1000, allVariants: true, minSubtotal: 10000, combinesWith: ['shipping'] }),
  },
  {
    id: 'shipping',
    name: 'Free shipping',
    use: 'Free delivery over a minimum spend.',
    why: 'Shipping is usually the smallest cost, so it combines with product and order discounts. The minimum keeps small orders paying for delivery.',
    build: (store) => ({ ...base, id: freeCode(store, 'FREESHIP50'), title: 'Free shipping', class: 'shipping', allVariants: true, minSubtotal: 5000, combinesWith: ['product', 'order'] }),
  },
  {
    id: 'clearance',
    name: 'Clearance',
    use: 'A deep discount to clear old stock.',
    why: 'Combines with nothing, so no other code can push a deep discount further below cost.',
    build: (store) => ({ ...base, id: freeCode(store, 'CLEAR40'), title: 'Clearance', class: 'product', bps: 4000, ...firstCollection(store), combinesWith: [] }),
  },
];
