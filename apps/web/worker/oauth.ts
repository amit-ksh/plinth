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
