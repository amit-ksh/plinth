import { changeId, type Change } from './fixes.ts';
import { CURRENCIES, type Currency } from './format.ts';
import type { Discount } from './types.ts';
import { InputError } from './validate.ts';

export interface Settings {
  storeName: string;
  currency: Currency;
  shippingCost: number;
  maxQty: number;
  floorBps: number;
}

export interface ChecklistItem {
  id: string;
  changes: Change[];
  /** Product titles this was added for. */
  products: string[];
  done: boolean;
}

export type HistoryAction = 'create' | 'update' | 'end' | 'reactivate' | 'delete' | 'fix' | 'rollback';

/** One change to one discount, with the full discount before and after, so it can be rolled back. */
export interface HistoryEntry {
  id: string;
  at: number;
  action: HistoryAction;
  discount: string;
  before: Discount | null;
  after: Discount | null;
  /** Whether the change was written to Shopify or only to this audit. */
  where: 'shopify' | 'local';
  rolledBack: boolean;
}

/** Shopify IDs for what was imported, so changes can be written back. Keys are Plinth IDs. */
export interface ShopifyLink {
  shop: string;
  variants: Record<string, string>;
  collections: Record<string, string>;
  discounts: Record<string, string>;
}

export interface AppState {
  settings: Settings;
  checklist: ChecklistItem[];
  sample: boolean;
  history: HistoryEntry[];
  shopify: ShopifyLink | null;
}

export const HISTORY_LIMIT = 200;

export const defaultState = (sample: boolean): AppState => ({
  settings: { storeName: sample ? 'Demo store' : 'My store', currency: 'USD', shippingCost: 800, maxQty: 3, floorBps: 0 },
  checklist: [],
  sample,
  history: [],
  shopify: null,
});

const ACTIONS: readonly HistoryAction[] = ['create', 'update', 'end', 'reactivate', 'delete', 'fix', 'rollback'];
const GID = /^gid:\/\/shopify\/[A-Za-z]+\/\d+$/;
const SHOP = /^[a-z0-9][a-z0-9-]{0,59}\.myshopify\.com$/;

// The store validates discounts fully when one is rolled back; here only the shape is checked.
const isDiscount = (d: unknown): d is Discount => {
  const x = d as Partial<Discount> | null;
  return typeof x?.id === 'string' && typeof x.title === 'string' && ['product', 'order', 'shipping'].includes(x.class as string) &&
    Array.isArray(x.variants) && Array.isArray(x.collections) && Array.isArray(x.combinesWith) && Array.isArray(x.tags) && Array.isArray(x.acceptsTags);
};

function checkHistory(value: unknown): HistoryEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InputError(['This backup has a damaged history']);
  return value.slice(-HISTORY_LIMIT).map((e) => {
    const ok = typeof e?.id === 'string' && Number.isSafeInteger(e.at) && ACTIONS.includes(e.action) && typeof e.discount === 'string' &&
      (e.before === null || isDiscount(e.before)) && (e.after === null || isDiscount(e.after)) && (e.where === 'shopify' || e.where === 'local');
    if (!ok) throw new InputError(['This backup has a damaged history']);
    return { id: e.id, at: e.at, action: e.action, discount: e.discount, before: e.before, after: e.after, where: e.where, rolledBack: e.rolledBack === true };
  });
}

function checkLink(value: unknown): ShopifyLink | null {
  if (value === undefined || value === null) return null;
  const v = value as Partial<ShopifyLink>;
  const map = (m: unknown) => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
    const entries = Object.entries(m as Record<string, unknown>);
    return entries.every(([, gid]) => typeof gid === 'string' && GID.test(gid)) ? Object.fromEntries(entries) as Record<string, string> : null;
  };
  const variants = map(v.variants), collections = map(v.collections), discounts = map(v.discounts);
  if (typeof v.shop !== 'string' || !SHOP.test(v.shop) || !variants || !collections || !discounts) {
    throw new InputError(['This backup has a damaged Shopify link']);
  }
  return { shop: v.shop, variants, collections, discounts };
}

export function checkSettings(settings: Settings): void {
  const issues: string[] = [];
  const whole = (n: number, min: number, max: number) => Number.isSafeInteger(n) && n >= min && n <= max;
  if (typeof settings?.storeName !== 'string' || !settings.storeName.trim() || settings.storeName.length > 80) {
    issues.push('Enter a store name of up to 80 characters');
  }
  if (!CURRENCIES.includes(settings?.currency)) issues.push(`Choose one of ${CURRENCIES.join(', ')}`);
  if (!whole(settings?.shippingCost, 0, 100_000_000)) issues.push('Enter a shipping cost of 0 or more');
  if (!whole(settings?.maxQty, 1, 20)) issues.push('Enter a quantity from 1 to 20');
  if (!whole(settings?.floorBps, 0, 9999)) issues.push('Enter a margin from 0 to 99.99');
  if (issues.length) throw new InputError(issues);
}

function isChange(value: unknown): value is Change {
  const c = value as { kind?: string; discount?: unknown; value?: unknown } | null;
  if (typeof c?.discount !== 'string') return false;
  if (c.kind === 'end') return true;
  if (c.kind === 'class') return ['product', 'order', 'shipping'].includes(c.value as string);
  return c.kind === 'tag' && typeof c.value === 'string';
}

/** Backup files are untrusted, so only known, well-formed fields survive. */
export function checkState(value: unknown): AppState {
  const state = value as Partial<AppState> | null;
  if (!state?.settings || !Array.isArray(state.checklist)) throw new InputError(['This backup is missing its settings']);
  checkSettings(state.settings);
  const { storeName, currency, shippingCost, maxQty, floorBps } = state.settings;

  const checklist = state.checklist.map((item) => {
    if (!Array.isArray(item?.changes) || !item.changes.length || !item.changes.every(isChange)) {
      throw new InputError(['This backup has a damaged checklist']);
    }
    return {
      id: changeId(item.changes),
      changes: item.changes,
      products: Array.isArray(item.products) ? item.products.filter((p) => typeof p === 'string') : [],
      done: item.done === true,
    };
  });

  return {
    settings: { storeName, currency, shippingCost, maxQty, floorBps },
    checklist,
    sample: state.sample === true,
    history: checkHistory(state.history),
    shopify: checkLink(state.shopify),
  };
}
