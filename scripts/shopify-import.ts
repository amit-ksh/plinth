// Reads a Shopify store and writes a directory store for the MCP server, or the raw data with --raw.
//
//   SHOPIFY_STORE=my-shop SHOPIFY_TOKEN=shpat_... npm run shopify:import -- data/my-shop
//   SHOPIFY_STORE=my-shop SHOPIFY_API_KEY=... SHOPIFY_API_SECRET=... npm run shopify:import -- data/my-shop
//
// The second form uses the client credentials grant, which works for apps and stores in the same
// Shopify organization. The token needs read_products, read_discounts and read_inventory.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defaultState } from '../packages/core/src/app-state.ts';
import { openNative } from '../packages/core/src/native.ts';
import * as Q from '../packages/core/src/queries.ts';
import { fromShopify, pullShopify, SHOPIFY_API_VERSION } from '../packages/core/src/shopify.ts';
import { loadStore } from '../packages/core/src/store.ts';
import { InputError } from '../packages/core/src/validate.ts';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const rawAt = args.indexOf('--raw');
const rawFile = rawAt >= 0 ? args.splice(rawAt, 2)[1] : null;
const [to] = args;
const shopName = (process.env.SHOPIFY_STORE ?? '').replace(/\.myshopify\.com$/, '');

if (!shopName || (!to && !rawFile)) fail('Usage: SHOPIFY_STORE=<shop> SHOPIFY_TOKEN=<token> npm run shopify:import -- <new directory> [--raw file.json]');
if (!/^[a-z0-9][a-z0-9-]*$/.test(shopName)) fail('SHOPIFY_STORE is the part before .myshopify.com, for example my-shop');
if (to && existsSync(to)) fail(`${to} already exists. Choose a new directory, or move that one away.`);
const shop = `${shopName}.myshopify.com`;

async function token(): Promise<string> {
  if (process.env.SHOPIFY_TOKEN) return process.env.SHOPIFY_TOKEN;
  const { SHOPIFY_API_KEY: id, SHOPIFY_API_SECRET: secret } = process.env;
  if (!id || !secret) fail('Set SHOPIFY_TOKEN, or SHOPIFY_API_KEY and SHOPIFY_API_SECRET');
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
  });
  const body = (await res.json().catch(() => null)) as { access_token?: string } | null;
  if (!body?.access_token) fail(`Shopify refused the credentials (HTTP ${res.status}). Is the app installed on ${shop}?`);
  return body.access_token;
}

const access = await token();
const pull = await pullShopify(async (query, variables) => {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': access },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) fail(`Shopify answered HTTP ${res.status}. Check the token's scopes: read_products, read_discounts, read_inventory.`);
  return res.json();
});

if (rawFile) {
  writeFileSync(rawFile, JSON.stringify(pull, null, 2));
  console.log(`Wrote ${rawFile}`);
}

if (to) {
  try {
    const result = fromShopify(pull);
    mkdirSync(dirname(resolve(to)), { recursive: true });
    const db = openNative(resolve(to));
    loadStore(db, result.store);
    const app = defaultState(false);
    app.settings.storeName = result.storeName;
    if (result.currency) app.settings.currency = result.currency;
    db.query(Q.WRITE_APP, { json: JSON.stringify(app) });
    db.checkpoint();
    console.log(`Created ${to} with ${result.store.variants.length} products and ${result.store.discounts.length} discounts from ${result.storeName}.`);
    for (const note of result.notes) console.log(`- ${note}`);
  } catch (error) {
    if (error instanceof InputError) fail(error.issues.join('\n'));
    throw error;
  }
}
