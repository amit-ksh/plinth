// Shopify OAuth checks for the Worker. Pure functions on Web Crypto, so they run in Workers and in Node tests.

/** Accepts "my-shop" or "my-shop.myshopify.com", in any case. Returns the full domain, or null. */
export function normalizeShop(input: string | null): string | null {
  const shop = (input ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.myshopify\.com$/, '');
  return /^[a-z0-9][a-z0-9-]{0,59}$/.test(shop) ? `${shop}.myshopify.com` : null;
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function randomState(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Shopify signs callback query strings: every parameter except hmac, sorted, joined with &, HMAC-SHA256 in hex. */
export async function validHmac(params: URLSearchParams, secret: string): Promise<boolean> {
  const given = params.get('hmac');
  if (!given || !secret) return false;
  const message = [...params]
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return sameText(expected, given.toLowerCase());
}

export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/** JSON that is safe inside a <script type="application/json"> element: <, U+2028 and U+2029 become escapes. */
const BACKSLASH = String.fromCharCode(92);
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, `${BACKSLASH}u003c`)
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), `${BACKSLASH}u2028`)
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), `${BACKSLASH}u2029`);
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function sessionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`plinth-session-v1:${secret}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export interface Session {
  shop: string;
  token: string;
  /** Epoch milliseconds. */
  expires: number;
}

/** Encrypts the session for an HttpOnly cookie, so the browser holds it but can't read the token. */
export async function sealSession(session: Session, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sessionKey(secret), new TextEncoder().encode(JSON.stringify(session)));
  return `${b64(iv)}.${b64(new Uint8Array(data))}`;
}

export async function openSession(sealed: string | null, secret: string, now = Date.now()): Promise<Session | null> {
  if (!sealed || !secret) return null;
  try {
    const [iv, data] = sealed.split('.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await sessionKey(secret), unb64(data));
    const session = JSON.parse(new TextDecoder().decode(plain)) as Session;
    if (typeof session.shop !== 'string' || typeof session.token !== 'string' || !(session.expires > now)) return null;
    return session;
  } catch {
    return null;
  }
}

/** Shopify signs webhook bodies: base64 HMAC-SHA256 of the raw body with the app's secret. */
export async function validWebhook(body: ArrayBuffer, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, body))));
  return sameText(expected, signature);
}

export interface ChangeEvent {
  id: string;
  topic: string;
  /** Epoch milliseconds. */
  at: number;
  label: string;
  gid: string | null;
}

/** A short, cost-free line for a webhook, or null for topics Plinth doesn't track. */
export function describeWebhook(topic: string, payload: any, id: string, at: number): ChangeEvent | null {
  const gid = typeof payload?.admin_graphql_api_id === 'string' ? payload.admin_graphql_api_id : null;
  const name = String(payload?.title ?? payload?.sku ?? payload?.id ?? '').slice(0, 120);
  const labels: Record<string, string> = {
    'discounts/create': `Discount created: ${name}`,
    'discounts/update': `Discount changed: ${name}`,
    'discounts/delete': 'A discount was deleted',
    'products/update': `Product changed: ${name}`,
    'inventory_items/update': `Cost or inventory item changed${payload?.sku ? `: ${String(payload.sku).slice(0, 60)}` : ''}`,
  };
  const label = labels[topic];
  return label ? { id: id.slice(0, 80), topic, at, label, gid } : null;
}

/** Only Slack incoming-webhook URLs are accepted, so the Worker can't be pointed at anything else. */
export const isSlackUrl = (url: unknown): url is string =>
  typeof url === 'string' && url.length <= 300 && /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(url);
