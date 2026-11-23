// Cloudflare Worker: serves the static app and two Shopify routes.
//
// /api/shopify/start     redirects to Shopify's consent screen for read-only access.
// /api/shopify/callback  checks the signature and state, exchanges the code for a short-lived online token,
//                        reads products and discounts once, and hands the mapped store to the browser.
//
// Nothing is stored: the token and the store data live only for this one request.
import { fromShopify, pullShopify, SHOPIFY_API_VERSION, SHOPIFY_SCOPES } from '../../../packages/core/src/shopify.ts';
import { InputError } from '../../../packages/core/src/validate.ts';
import { normalizeShop, randomState, readCookie, scriptJson, validHmac } from './oauth.ts';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
}

const STATE_COOKIE = 'plinth_shopify_state';
const SECURITY = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

/** The page that carries the result into the app. Its only script is a same-origin file, so no inline code runs. */
function handoff(payload: object, clearState: boolean): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Plinth</title></head>
<body><p id="status">Opening Plinth…</p><script type="application/json" id="shopify-result">${scriptJson(payload)}</script><script src="/shopify-handoff.js"></script></body></html>`;
  const headers = new Headers({ ...SECURITY, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
  if (clearState) headers.append('Set-Cookie', `${STATE_COOKIE}=; Path=/api/shopify; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return new Response(html, { status: 200, headers });
}

const failure = (message: string) => handoff({ error: message }, true);

async function start(url: URL, env: Env): Promise<Response> {
  const shop = normalizeShop(url.searchParams.get('shop'));
  if (!shop) return failure('Enter your store’s address, like my-shop or my-shop.myshopify.com.');
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET) return failure('The Shopify connection isn’t set up on this server.');
  const state = randomState();
  const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
  authorize.searchParams.set('client_id', env.SHOPIFY_API_KEY);
  authorize.searchParams.set('scope', SHOPIFY_SCOPES);
  authorize.searchParams.set('redirect_uri', `${url.origin}/api/shopify/callback`);
  authorize.searchParams.set('state', state);
  authorize.searchParams.append('grant_options[]', 'per-user');
  return new Response(null, {
    status: 302,
    headers: { ...SECURITY, Location: authorize.toString(), 'Set-Cookie': `${STATE_COOKIE}=${state}; Path=/api/shopify; Max-Age=600; HttpOnly; Secure; SameSite=Lax` },
  });
}

async function callback(request: Request, url: URL, env: Env): Promise<Response> {
  const params = url.searchParams;
  if (params.get('error')) return failure('Shopify access wasn’t approved, so nothing was read.');
  const shop = normalizeShop(params.get('shop'));
  const state = readCookie(request.headers.get('Cookie'), STATE_COOKIE);
  if (!shop || !state || params.get('state') !== state) return failure('This sign-in link expired or was opened in another browser. Connect again.');
  if (!(await validHmac(params, env.SHOPIFY_API_SECRET))) return failure('Shopify’s signature didn’t match, so nothing was read. Connect again.');
  const timestamp = Number(params.get('timestamp'));
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 600) return failure('This sign-in link expired. Connect again.');

  const exchange = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: env.SHOPIFY_API_KEY, client_secret: env.SHOPIFY_API_SECRET, code: params.get('code') }),
  });
  const grant = (await exchange.json().catch(() => null)) as { access_token?: string; scope?: string } | null;
  if (!grant?.access_token) return failure('Shopify didn’t grant access. Connect again.');
  const granted = new Set((grant.scope ?? '').split(','));
  if (!SHOPIFY_SCOPES.split(',').every((s) => granted.has(s) || granted.has(s.replace('read_', 'write_')))) {
    return failure('Plinth needs to read products, discounts and inventory costs. Approve all three and connect again.');
  }

  try {
    const pull = await pullShopify(async (query, variables) => {
      const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': grant.access_token! },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
    const result = fromShopify(pull);
    return handoff({ shop, ...result }, true);
  } catch (error) {
    if (error instanceof InputError) return failure(`Plinth couldn’t read this store: ${error.issues.slice(0, 3).join('; ')}`);
    return failure('Plinth couldn’t read this store from Shopify. Try again in a minute.');
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/shopify/start') return start(url, env);
    if (request.method === 'GET' && url.pathname === '/api/shopify/callback') return callback(request, url, env);
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404, headers: SECURITY });
    return env.ASSETS.fetch(request);
  },
};
