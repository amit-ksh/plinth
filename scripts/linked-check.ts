// Exercises Shopify-linked mode in a real browser against a mock of the Worker's /api/shopify routes,
// and checks what the app sends. Run against the hosted build:
//   npm run build:hosted -w @app/web && node --experimental-strip-types scripts/linked-check.ts
import assert from 'node:assert/strict';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { fromShopify } from '../packages/core/src/shopify.ts';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'apps/web/dist');
const SHOP = 'plinth-test-fydvykq5.myshopify.com';
const pulled = fromShopify(JSON.parse(readFileSync(join(root, 'packages/core/test/shopify-fixture.json'), 'utf8')));
const link = { ...pulled.link, shop: SHOP };
const store = { ...pulled.store, variants: pulled.store.variants.map(({ image: _i, ...v }) => v) };

const writes: { kind: string; id: string; ends?: number | null }[] = [];
const codes: number[] = [];
let alerts: string | null = null;
let changeServed = false;
let next = 900;

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const body = (req: import('node:http').IncomingMessage) => new Promise<any>((done) => {
  let text = '';
  req.on('data', (c) => (text += c));
  req.on('end', () => done(text ? JSON.parse(text) : null));
});
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const send = (status: number, data: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
  if (url.pathname.startsWith('/api/shopify/')) {
    const route = url.pathname.slice('/api/shopify/'.length);
    if (req.method === 'POST' && req.headers['x-plinth'] !== '1') return send(403, { issues: ['Not allowed'] });
    if (route === 'session') return send(200, { connected: true, shop: SHOP, expires: Date.now() + 3_600_000, watching: true });
    if (route === 'pull') return send(200, { shop: SHOP, ...pulled, store, link });
    if (route === 'changes') {
      if (changeServed) return send(200, { events: [] });
      changeServed = true;
      return send(200, { events: [{ id: 'w1', topic: 'discounts/update', at: Date.now(), label: 'Discount changed: BOOT20', gid: link.discounts.BOOT20 }] });
    }
    if (route === 'alerts') {
      if (req.method === 'GET') return send(200, { slack: alerts });
      const b = await body(req);
      if (b.slack === null) return send(200, { slack: (alerts = null) });
      if (!/^https:\/\/hooks\.slack\.com\/services\//.test(b.slack)) return send(400, { issues: ['Paste a Slack incoming webhook URL, starting https://hooks.slack.com/services/'] });
      return send(200, { slack: (alerts = `${b.slack.slice(0, 40)}…`) });
    }
    if (route === 'codes') {
      const b = await body(req);
      codes.push(b.codes.length);
      return send(200, { queued: b.codes.length });
    }
    if (route === 'discount') {
      const b = await body(req);
      assert.equal(b.link.shop, SHOP);
      if (b.discount.id === 'FAILME') return send(422, { issues: ['Shopify: Code must be unique. Please try a different code.'] });
      writes.push({ kind: b.kind, id: b.discount.id, ends: b.discount.ends });
      return send(200, { gid: b.kind === 'delete' ? null : b.gid ?? `gid://shopify/DiscountCodeNode/${next++}` });
    }
    return send(404, { issues: ['Not found'] });
  }
  const file = resolve(dist, url.pathname.endsWith('/') ? `.${url.pathname}index.html` : `.${url.pathname}`);
  if (!file.startsWith(dist + sep) || !existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;

const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
const page = await context.newPage();
const problems: string[] = [];
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(String(e)));
const go = (hash: string) => page.evaluate((h) => (location.hash = h), hash).then(() => page.waitForTimeout(300));
const button = (name: string) => page.getByRole('button', { name, exact: true }).first().click();
const toast = (text: string | RegExp) => page.locator('.toast', { hasText: text }).waitFor();
let failed = 0;
const step = async (name: string, run: () => Promise<void>) => {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}\n     ${String((error as Error).message).split('\n').slice(0, 6).join('\n     ')}`);
  }
};

await page.goto(`${base}app/?demo`);
await page.locator('main h1').first().waitFor();

await step('a Shopify hand-off imports the store and links it', async () => {
  await page.evaluate((text) => sessionStorage.setItem('plinth-shopify', text), JSON.stringify({ shop: SHOP, ...pulled, store, link }));
  await go('import');
  await page.getByRole('heading', { name: 'Ready to import 25 products and 15 discounts' }).waitFor();
  await button('Replace and audit');
  await page.locator('.source.linked', { hasText: 'Linked to plinth-test' }).waitFor();
});

await step('an outside change shows a banner, and re-checking reads the store again', async () => {
  await go('home');
  await page.locator('.banner.changes', { hasText: 'Discount changed: BOOT20' }).waitFor({ timeout: 10_000 });
  await button('Re-check now');
  await toast(/Re-checked|New leak/);
  assert.equal(await page.locator('.banner.changes').count(), 0);
});

await step('a template is created in Shopify after the leak check', async () => {
  await go('discounts');
  await page.getByText(`saved to ${SHOP}`).waitFor();
  await go('discounts/:new');
  await page.getByRole('button', { name: /^Sitewide sale/ }).click();
  await button('Create in Shopify');
  await toast('SALE25 saved to Shopify');
  assert.deepEqual(writes.at(-1), { kind: 'create', id: 'SALE25', ends: null });
});

await step('a refused write changes nothing here and says why', async () => {
  const before = writes.length;
  await go('discounts');
  await go('discounts/:new');
  await button('Start from scratch');
  await page.getByLabel('Code', { exact: true }).fill('FAILME');
  await page.getByLabel('Percentage', { exact: true }).fill('5');
  await button('Create in Shopify');
  await toast('Code must be unique');
  assert.equal(writes.length, before);
  await go('discounts');
  assert.equal(await page.locator('tbody tr', { hasText: 'FAILME' }).count(), 0);
});

await step('end now and run again are written to Shopify', async () => {
  await go('discounts/SALE25');
  await button('End now');
  await toast('SALE25 ended');
  assert.equal(writes.at(-1)!.kind, 'update');
  assert.ok(typeof writes.at(-1)!.ends === 'number');
  await go('discounts');
  await go('discounts/SALE25');
  await button('Run again');
  await toast('SALE25 is running again');
  assert.equal(writes.at(-1)!.ends, null);
});

await step('pause all writes each live discount, and resume all puts them back', async () => {
  const before = writes.length;
  await go('discounts');
  await button('Pause all');
  await button('Pause all');
  await toast(/Paused \d+ live discounts in Shopify/);
  const paused = writes.length - before;
  assert.ok(paused >= 5, `${paused} pause writes`);
  await button('Resume all');
  await toast(/Resumed \d+ in Shopify/);
  assert.equal(writes.length - before, paused * 2);
});

await step('unique codes are added to the discount in Shopify and downloaded', async () => {
  await go('discounts/BUNDLE20');
  await page.getByText('Generate unique codes').click();
  await page.getByLabel('How many').fill('12');
  const [download] = await Promise.all([page.waitForEvent('download'), button('Add to Shopify and download')]);
  assert.equal((await download.suggestedFilename()), 'BUNDLE20-codes.csv');
  await toast('12 codes added to BUNDLE20 in Shopify');
  assert.deepEqual(codes, [12]);
});

await step('history rolls back the latest change in Shopify', async () => {
  const before = writes.length;
  await go('history');
  await page.getByRole('button', { name: /^Roll back:/ }).first().click();
  await toast('Rolled back in Shopify');
  assert.ok(writes.length > before);
});

await step('delete is written to Shopify', async () => {
  await go('discounts/SALE25');
  await button('Delete from Shopify');
  await toast('SALE25 deleted from Shopify');
  assert.deepEqual(writes.at(-1)!.kind, 'delete');
});

await step('Slack alerts validate the URL and save it', async () => {
  await go('settings');
  await page.getByText('Discount changes are saved there.').waitFor();
  const field = page.getByLabel(/Slack incoming webhook URL/);
  await field.fill('https://example.com/hook');
  await button('Turn on Slack alerts');
  await page.getByText('Paste a Slack incoming webhook URL').waitFor();
  await field.fill('https://hooks.slack.com/services/T000/B000/abc');
  await button('Turn on Slack alerts');
  await page.getByText(/Posting to/).waitFor();
});

await step('no console errors other than the refusals this check asked for', async () => {
  // The browser logs every 4xx response; the refused code (422) and the bad Slack URL (400) are deliberate.
  const expected = /Failed to load resource: the server responded with a status of (422|400)/;
  assert.deepEqual(problems.filter((p) => !expected.test(p)), []);
});

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
