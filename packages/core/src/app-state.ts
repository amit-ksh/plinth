import { changeId, type Change } from './fixes.ts';
import { CURRENCIES, type Currency } from './format.ts';
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

export interface AppState {
  settings: Settings;
  checklist: ChecklistItem[];
  sample: boolean;
}

export const defaultState = (sample: boolean): AppState => ({
  settings: { storeName: sample ? 'Demo store' : 'My store', currency: 'USD', shippingCost: 800, maxQty: 3, floorBps: 0 },
  checklist: [],
  sample,
});

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

  return { settings: { storeName, currency, shippingCost, maxQty, floorBps }, checklist, sample: state.sample === true };
}
