// Cloudflare Worker: serves the static app and the Shopify routes.
//
// GET  /api/shopify/start       redirects to Shopify's consent screen.
// GET  /api/shopify/callback    checks signature and state, trades the code for a short-lived online token,
//                               reads the store once, hands it to the browser, and sets the session cookie.
// GET  /api/shopify/session     whether this browser is connected, and to which store.
// POST /api/shopify/pull        reads the store again.
// POST /api/shopify/discount    writes one discount change (create, update or delete).
// POST /api/shopify/disconnect  forgets the session.
//
// Nothing is stored on the server. The token lives in an encrypted HttpOnly cookie that expires with it.
import type { ShopifyLink } from '../../../packages/core/src/app-state.ts';
import { fromShopify, pullShopify, SHOPIFY_API_VERSION, SHOPIFY_SCOPES, type ShopifyRequest } from '../../../packages/core/src/shopify.ts';
import { writeDiscount, type WriteKind } from '../../../packages/core/src/shopify-write.ts';
import type { Discount } from '../../../packages/core/src/types.ts';
import { InputError } from '../../../packages/core/src/validate.ts';
import { normalizeShop, openSession, randomState, readCookie, scriptJson, sealSession, validHmac, type Session } from './oauth.ts';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
}

const STATE_COOKIE = 'plinth_shopify_state';
const SESSION_COOKIE = 'plinth_shopify_session';
const SECURITY = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};
const cookie = (name: string, value: string, maxAge: number) => `${name}=${value}; Path=/api/shopify; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

/** The page that carries the result into the app. Its only script is a same-origin file, so no inline code runs. */
function handoff(payload: object, cookies: string[]): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Plinth</title></head>
<body><p id="status">Opening Plinth…</p><script type="application/json" id="shopify-result">${scriptJson(payload)}</script><script src="/shopify-handoff.js"></script></body></html>`;
  const headers = new Headers({ ...SECURITY, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(html, { status: 200, headers });
}

const failure = (message: string) => handoff({ error: message }, [cookie(STATE_COOKIE, '', 0)]);

function json(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ ...SECURITY, 'Content-Type': 'application/json' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}
const problem = (status: number, issues: string[]) => json({ issues }, status);

function shopifyRequest(session: Session): ShopifyRequest {
  return async (query, variables) => {
    const res = await fetch(`https://${session.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401 || res.status === 403) throw new InputError(['Shopify ended this session. Connect again from Import']);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
}

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
  return new Response(null, { status: 302, headers: { ...SECURITY, Location: authorize.toString(), 'Set-Cookie': cookie(STATE_COOKIE, state, 600) } });
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
  const grant = (await exchange.json().catch(() => null)) as { access_token?: string; scope?: string; expires_in?: number } | null;
  if (!grant?.access_token) return failure('Shopify didn’t grant access. Connect again.');
  const granted = new Set((grant.scope ?? '').split(','));
  const covers = (s: string) => granted.has(s) || granted.has(s.replace('read_', 'write_'));
  if (!SHOPIFY_SCOPES.split(',').every(covers)) {
    return failure('Plinth needs to read products and inventory costs and to manage discounts. Approve all of them and connect again.');
  }
  const lifetime = Math.max(60, Math.min(grant.expires_in ?? 3600, 86_400));
  const session: Session = { shop, token: grant.access_token, expires: Date.now() + lifetime * 1000 };

  try {
    const result = fromShopify(await pullShopify(shopifyRequest(session)));
    const sealed = await sealSession(session, env.SHOPIFY_API_SECRET);
    return handoff({ shop, ...result }, [cookie(STATE_COOKIE, '', 0), cookie(SESSION_COOKIE, sealed, lifetime)]);
  } catch (error) {
    if (error instanceof InputError) return failure(`Plinth couldn’t read this store: ${error.issues.slice(0, 3).join('; ')}`);
    return failure('Plinth couldn’t read this store from Shopify. Try again in a minute.');
  }
}

/** API calls must come from this site's own pages: same origin, JSON, and a custom header. */
function sameSite(request: Request, url: URL): boolean {
  return request.headers.get('Origin') === url.origin && request.headers.get('X-Plinth') === '1';
}

const isText = (v: unknown, max = 500) => typeof v === 'string' && v.length <= max;
const isTexts = (v: unknown) => Array.isArray(v) && v.length <= 10_000 && v.every((x) => isText(x));
const whole = (v: unknown, max: number) => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
const isTime = (v: unknown) => v === null || Number.isSafeInteger(v);

function isDiscount(d: any): d is Discount {
  return (
    d && isText(d.id, 128) && /^[A-Za-z0-9_.:/-]{1,128}$/.test(d.id) && isText(d.title) && ['product', 'order', 'shipping'].includes(d.class) &&
    ['code', 'automatic'].includes(d.method) && whole(d.bps, 10000) && whole(d.off, 1e12) && whole(d.minSubtotal, 1e12) &&
    typeof d.allVariants === 'boolean' && isTexts(d.variants) && isTexts(d.collections) && isTexts(d.combinesWith) &&
    isTexts(d.tags) && isTexts(d.acceptsTags) && isTime(d.starts) && isTime(d.ends) && typeof d.supported === 'boolean'
  );
}

const GID = /^gid:\/\/shopify\/[A-Za-z]+\/\d+$/;
function isLink(l: any, shop: string): l is ShopifyLink {
  const map = (m: unknown) => !!m && typeof m === 'object' && Object.values(m as object).every((g) => typeof g === 'string' && GID.test(g));
  return l && l.shop === shop && map(l.variants) && map(l.collections) && map(l.discounts);
}

async function discount(request: Request, session: Session): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { kind?: WriteKind; discount?: unknown; previous?: unknown; gid?: unknown; link?: unknown } | null;
  if (!body || !['create', 'update', 'delete'].includes(body.kind as string)) return problem(400, ['Unknown change']);
  if (!isDiscount(body.discount) || (body.previous !== null && !isDiscount(body.previous))) return problem(400, ['That discount isn’t valid']);
  if (body.gid !== null && !(typeof body.gid === 'string' && GID.test(body.gid))) return problem(400, ['That Shopify ID isn’t valid']);
  if (!isLink(body.link, session.shop)) return problem(409, [`This audit isn’t linked to ${session.shop}. Import it from Shopify again`]);
  try {
    const gid = await writeDiscount(shopifyRequest(session), body.kind!, body.discount, {
      previous: (body.previous as Discount | null) ?? null,
      gid: (body.gid as string | null) ?? null,
      link: body.link,
      now: Date.now(),
    });
    return json({ gid });
  } catch (error) {
    if (error instanceof InputError) return problem(422, error.issues);
    return problem(502, ['Shopify didn’t answer. Nothing may have changed; refresh from Shopify to check']);
  }
}

async function api(request: Request, url: URL, env: Env): Promise<Response> {
  const session = await openSession(readCookie(request.headers.get('Cookie'), SESSION_COOKIE), env.SHOPIFY_API_SECRET);
  if (request.method === 'GET' && url.pathname === '/api/shopify/session') {
    return json(session ? { connected: true, shop: session.shop, expires: session.expires } : { connected: false });
  }
  if (request.method !== 'POST') return problem(405, ['Not allowed']);
  if (!sameSite(request, url)) return problem(403, ['Not allowed']);
  if (url.pathname === '/api/shopify/disconnect') return json({ connected: false }, 200, [cookie(SESSION_COOKIE, '', 0)]);
  if (!session) return problem(401, ['Your Shopify session ended. Connect again from Import']);
  if (url.pathname === '/api/shopify/pull') {
    try {
      return json({ shop: session.shop, ...fromShopify(await pullShopify(shopifyRequest(session))) });
    } catch (error) {
      if (error instanceof InputError) return problem(422, error.issues);
      return problem(502, ['Plinth couldn’t read the store from Shopify. Try again in a minute']);
    }
  }
  if (url.pathname === '/api/shopify/discount') return discount(request, session);
  return problem(404, ['Not found']);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/shopify/start') return start(url, env);
    if (request.method === 'GET' && url.pathname === '/api/shopify/callback') return callback(request, url, env);
    if (url.pathname.startsWith('/api/shopify/')) return api(request, url, env);
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404, headers: SECURITY });
    return env.ASSETS.fetch(request);
  },
};
