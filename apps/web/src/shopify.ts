// Talks to the Shopify routes of the Worker (apps/web/worker). Only on hosts built with VITE_SHOPIFY_CONNECT.
import type { ShopifyLink } from '../../../packages/core/src/app-state.ts';
import type { ShopifyImport } from '../../../packages/core/src/shopify.ts';
import type { Discount } from '../../../packages/core/src/types.ts';

export const SHOPIFY_CONNECT = import.meta.env.VITE_SHOPIFY_CONNECT === '1';

/** A failure the person can act on, in their words. */
export class ShopifyError extends Error {
  readonly issues: string[];
  readonly status: number;
  constructor(issues: string[], status: number) {
    super(issues.join('. '));
    this.issues = issues;
    this.status = status;
  }
}

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/shopify/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Plinth': '1' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ShopifyError(['Plinth couldn’t reach Shopify. Check your connection and try again'], 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ShopifyError(Array.isArray(data?.issues) ? data.issues : ['Shopify didn’t accept that. Try again'], res.status);
  return data as T;
}

export async function shopifySession(): Promise<{ connected: boolean; shop?: string; expires?: number }> {
  if (!SHOPIFY_CONNECT) return { connected: false };
  try {
    const res = await fetch('/api/shopify/session', { credentials: 'same-origin' });
    return res.ok ? await res.json() : { connected: false };
  } catch {
    return { connected: false };
  }
}

export const pullShopify = () => post<ShopifyImport & { shop: string }>('pull');
export const disconnectShopify = () => post<{ connected: false }>('disconnect');

export function writeShopify(kind: 'create' | 'update' | 'delete', discount: Discount, previous: Discount | null, link: ShopifyLink): Promise<{ gid: string | null }> {
  const gid = previous ? link.discounts[previous.id] ?? null : null;
  return post('discount', { kind, discount, previous, gid, link });
}

/** Starts the Shopify sign-in for this store. Leaves the page. */
export function connectShopify(shop: string): void {
  location.assign(`/api/shopify/start?shop=${encodeURIComponent(shop)}`);
}
