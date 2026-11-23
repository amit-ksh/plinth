// End-to-end test of the production build in a real browser.
//   npm run build && npm run test:e2e
// BROWSER_CHANNEL picks the installed browser (msedge or chrome). SHOTS=<dir> also saves screenshots.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { DISCOUNTS_TEMPLATE, PRODUCTS_TEMPLATE } from '../packages/core/src/csv.ts';
import { fromShopify } from '../packages/core/src/shopify.ts';
import { serve } from './static-server.ts';

const root = resolve(import.meta.dirname, '..');
const channel = process.env.BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome');
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
// E2E_URL tests a deployed copy instead of the local build.
const { server, url } = process.env.E2E_URL
  ? { server: null, url: process.env.E2E_URL }
  : await serve(join(root, 'apps/web/dist'));
const profile = mkdtempSync(join(tmpdir(), 'plinth-e2e-'));

const failures: string[] = [];
const problems: string[] = []; // console errors, CSP violations, requests leaving the device
let passed = 0;

async function step(name: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
    passed++;
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}\n     ${String((error as Error).message).split('\n').slice(0, 8).join('\n     ')}`);
    if (shots) await page.screenshot({ path: join(shots, `fail-${failures.length}.png`) }).catch(() => {});
  }
}

function watch(context: BrowserContext): void {
  context.on('request', (request) => {
    const to = request.url();
    if (!to.startsWith(url) && !/^(data|blob|about):/.test(to)) problems.push(`request left the device: ${to}`);
  });
  const listen = (p: Page) => {
    p.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
    p.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console: ${message.text()}`);
    });
  };
  context.pages().forEach(listen);
  context.on('page', listen);
}

const launch = async () => {
  const context = await chromium.launchPersistentContext(profile, {
    channel,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  watch(context);
  return context;
};

let context = await launch();
let page = context.pages()[0] ?? (await context.newPage());
page.setDefaultTimeout(15_000);

async function go(route: string): Promise<void> {
  await page.evaluate((to) => {
    location.hash = to;
  }, route);
  await page.waitForTimeout(250);
}
const heading = (name: string | RegExp) => page.getByRole('heading', { name }).first().waitFor();
const button = (name: string) => page.getByRole('button', { name, exact: true }).first().click();
const shot = async (name: string) => {
  if (shots) await page.screenshot({ path: join(shots, `flow-${name}.png`) });
};
const toast = (text: string | RegExp) => page.locator('.toast', { hasText: text }).waitFor();
const focused = () => page.evaluate(() => document.activeElement?.id ?? '');

async function checkPromotion(text: string): Promise<void> {
  await page.getByLabel('Describe a promotion').fill(text);
  await button('Check promotion');
}

async function downloadText(click: () => Promise<void>): Promise<string> {
  const [file] = await Promise.all([page.waitForEvent('download'), click()]);
  return readFileSync((await file.path())!, 'utf8');
}

const csv = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });

try {
  await page.goto(url);

  await step('opens on the prompt, with the sample audited', async () => {
    await heading('2 products sell below cost');
    await page.getByText('Winter jacket loses $5.00').waitFor();
    await page.getByText('Leather boots loses $2.00').waitFor();
    assert.equal(await page.locator('.ledger-row').count(), 3);
  });

  await step('empty and unsupported promotions explain the fix', async () => {
    await button('Check promotion');
    await page.getByText('Describe the promotion, for example').waitFor();
    assert.equal(await focused(), 'promotion');
    await checkPromotion('buy 2 get 1 free');
    await page.getByText('Buy X, get Y isn’t supported yet').waitFor();
  });

  await step('a risky promotion is caught, and Enter submits', async () => {
    const input = page.getByLabel('Describe a promotion');
    await input.fill('70% off winter');
    await input.press('Enter');
    await heading(/This would sell \d+ products? below cost/);
    assert.equal(await focused(), 'check-result');
  });

  await step('a harmless promotion says so', async () => {
    await checkPromotion('TINY: 1% off accessories');
    await heading('No leak found with this promotion');
  });

  await step('what was understood can be corrected', async () => {
    await page.getByText('Change what we understood').click();
    await page.getByLabel('Percentage', { exact: true }).fill('95');
    await button('Check again');
    await heading(/This would sell \d+ products? below cost/);
  });

  await step('a checked promotion can be added, then undone', async () => {
    await button('Add to this audit');
    await toast('TINY added to this audit');
    await go('discounts');
    await page.getByText('TINY', { exact: true }).waitFor();
    await button('Undo');
    await toast('Change undone');
    assert.equal(await page.getByText('TINY', { exact: true }).count(), 0);
  });

  await step('audit lists the biggest loss first', async () => {
    await go('audit');
    await heading('2 products sell below cost');
    assert.match((await page.locator('.rows .row').first().textContent())!, /Winter jacket.*Loses \$5\.00/);
  });

  await step('a leak reads as a receipt that adds up', async () => {
    await page.getByRole('link', { name: /Winter jacket.*Loses/ }).click();
    await heading('Winter jacket loses $5.00');
    await page.locator('.receipt').waitFor();
    const receipt = (await page.locator('.receipt').textContent())!;
    for (const amount of ['$100.00', '−$20.00', '−$12.00', '−$8.00', '$60.00', '$65.00']) assert.ok(receipt.includes(amount), amount);
  });

  await step('the proof shows every pair and the Relate query', async () => {
    await page.getByText('Why can these be used together?').click();
    assert.equal(await page.locator('.facts li').count(), 3);
    await page.getByText('Show the Relate query').click();
    assert.match((await page.locator('pre').textContent())!, /COMBINES_WITH/);
  });

  await step('a fix previews without changing anything', async () => {
    await button('Preview fix');
    await heading('After the fix, at worst');
    await page.locator('.receipt', { hasText: '$68.00' }).waitFor();
    assert.equal(await focused(), 'preview-toggle');
    await button('End preview');
    await page.locator('.receipt', { hasText: '$60.00' }).waitFor();
  });

  await step('another fix can be previewed', async () => {
    await page.getByText(/Show \d+ other fix/).click();
    await page.locator('.disclosure button.row').first().click();
    await heading('After the fix, at worst');
    await button('End preview');
  });

  await step('a fix goes to the checklist and updates the audit when made', async () => {
    await go('audit');
    await go('product/jacket');
    await button('Add to checklist');
    await toast('Fix added to your checklist');
    await go('checklist');
    await heading('Stop BUNDLE20 combining with shipping discounts');
    await button('I made this change');
    await toast('Marked as made');
    await go('audit');
    await heading('1 product sells below cost');
    await button('Undo');
    await heading('2 products sell below cost');
  });

  await step('a missing cost is refused, then saved', async () => {
    await go('product/gift-box');
    await page.getByLabel('Cost per item').fill('abc');
    await button('Save cost');
    await page.getByText('Enter what one item costs you').waitFor();
    await page.getByLabel('Cost per item').fill('10');
    await button('Save cost');
    await toast('Cost saved');
    await page.getByText('No leak found', { exact: true }).waitFor();
  });

  await step('a price below cost gets a fix too', async () => {
    await go('product/wool-cap');
    await page.getByText('Change the cost').click();
    await page.getByLabel('Cost per item').fill('35');
    await button('Save cost');
    await page.getByText('Raise the price above $35.00').waitFor();
    await button('Undo');
    await toast('Change undone');
    await go('product/gift-box');
  });

  await step('saved changes survive a reload', async () => {
    await page.reload();
    await page.getByText('No leak found', { exact: true }).waitFor();
  });

  await step('a second tab says it is not saving', async () => {
    const second = await context.newPage();
    await second.goto(`${url}#audit`);
    await second.getByText('Your audit is open in another tab').waitFor();
    await second.close();
  });

  await step('saved changes survive a browser restart', async () => {
    await context.close();
    context = await launch();
    page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(15_000);
    await page.goto(`${url}#product/gift-box`);
    await page.getByText('No leak found', { exact: true }).waitFor();
  });

  await step('search filters as you type, keeps focus, and recovers from no match', async () => {
    const search = page.getByLabel('Search products');
    await search.fill('boot');
    await page.getByText('1 result for “boot”').waitFor();
    assert.equal(await focused(), 'search');
    await search.fill('zzzz');
    await heading('No products match');
    await button('Clear search');
    await page.getByText('50 products', { exact: true }).waitFor();
  });

  await step('more products load on request', async () => {
    assert.equal(await page.locator('main tbody tr').count(), 25);
    await page.getByRole('button', { name: /Show 25 more/ }).click();
    assert.equal(await page.locator('main tbody tr').count(), 50);
  });

  await step('discounts can be added, edited and removed', async () => {
    await go('discounts/:new');
    await button('Start from scratch');
    await button('Add discount');
    await page.getByText('Use letters, numbers').waitFor();
    await page.getByLabel('Code', { exact: true }).fill('SPRING5');
    await page.getByLabel('Percentage', { exact: true }).fill('5');
    await button('Add discount');
    await toast('SPRING5 saved');
    await page.getByRole('link', { name: /SPRING5/ }).click();
    await page.getByLabel('Percentage', { exact: true }).fill('7');
    await button('Save changes');
    await page.locator('tbody tr', { hasText: 'SPRING5' }).filter({ hasText: '7% off' }).waitFor();
    await page.getByRole('link', { name: /SPRING5/ }).click();
    await button('Remove from audit');
    await toast('SPRING5 deleted');
  });

  await step('a template is checked for leaks before it saves', async () => {
    await go('discounts/:new');
    await shot('templates');
    await page.getByRole('button', { name: /^Clearance/ }).click();
    await heading('Clearance');
    await page.getByLabel('Applies to').selectOption({ label: 'Winter' });
    await button('Add discount');
    await heading(/This would sell \d+ products? below cost/);
    await page.locator('.card.leak', { hasText: 'Winter jacket' }).waitFor();
    assert.equal(await focused(), 'guard-title');
    await shot('guard');
    await button('Change it');
    await page.getByLabel('Percentage', { exact: true }).fill('20');
    await button('Add discount');
    await toast('CLEAR40 saved');
    await page.locator('tbody tr', { hasText: 'CLEAR40' }).waitFor();
  });

  await step('the calendar shows a scheduled sale on its days only', async () => {
    const day = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    await go('discounts');
    await go('discounts/:new');
    await button('Start from scratch');
    await page.getByLabel('Code', { exact: true }).fill('BFCM40');
    await page.getByLabel('Percentage', { exact: true }).fill('40');
    await page.getByLabel('Applies to').selectOption({ label: 'Winter' });
    await page.getByLabel('Starts (optional)').fill(day(5));
    await page.getByLabel('Last day (optional)').fill(day(7));
    await button('Add discount');
    await heading(/This would sell \d+ products? below cost/);
    await button('Save anyway');
    await toast('BFCM40 saved');
    await go('calendar');
    await heading('Calendar');
    await page.locator('.stretch.leak', { hasText: 'BFCM40' }).first().waitFor();
    const quiet = page.locator('.stretch').first();
    assert.ok(!(await quiet.textContent())!.includes('BFCM40'), 'not live today');
    assert.ok((await page.locator('.timeline .tl-bar', { hasText: 'BFCM40' }).count()) === 1);
    await shot('calendar');
  });

  await step('history lists each change and rolls back the latest', async () => {
    await go('history');
    await heading('History');
    await page.locator('tbody tr', { hasText: 'BFCM40' }).waitFor();
    await shot('history');
    await page.getByRole('button', { name: 'Roll back: Created BFCM40' }).click();
    await toast('Rolled back in this audit');
    await page.locator('tbody tr', { hasText: 'BFCM40' }).filter({ hasText: 'Rolled back' }).first().waitFor();
    await go('discounts');
    assert.equal(await page.locator('tbody tr', { hasText: 'BFCM40' }).count(), 0);
    await page.locator('tbody tr', { hasText: 'CLEAR40' }).waitFor();
  });

  await step('a collection guardrail warns, then blocks, a change that eats the margin', async () => {
    await go('settings');
    await page.getByLabel('Collection', { exact: true }).selectOption({ label: 'Knitwear' });
    await page.getByLabel('Minimum margin', { exact: true }).fill('45');
    await button('Add minimum margin');
    await toast('Knitwear minimum margin saved');
    await go('discounts/KNIT10');
    await page.getByLabel('Percentage', { exact: true }).fill('50');
    await button('Save changes');
    await heading(/below (its|their) minimum margin/);
    await page.getByText(/margin, minimum 45%/).first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save anyway', exact: true }).count(), 1);
    await shot('guardrail');
    await go('settings');
    await page.getByLabel('Block the save').click();
    await toast('now blocked');
    await go('discounts');
    await go('discounts/KNIT10');
    await page.getByLabel('Percentage', { exact: true }).fill('50');
    await button('Save changes');
    await page.getByText('Your guardrails block this change').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save anyway', exact: true }).count(), 0);
    await go('settings');
    await page.getByLabel('Warn, and allow saving anyway').click();
    await toast('now warn');
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await toast('Knitwear minimum margin removed');
  });

  await step('pause all ends every live discount, and resume all brings them back', async () => {
    await go('discounts');
    await button('Pause all discounts');
    await button('Pause all');
    await toast(/Paused \d+ live discounts/);
    await page.getByText(/discounts paused/).waitFor();
    await go('home');
    await heading('No leak found in this audit');
    await go('discounts');
    await shot('paused');
    await button('Resume all');
    await toast(/Resumed \d+/);
    await go('home');
    await heading('2 products sell below cost');
  });

  await step('unique codes download for a code discount', async () => {
    await go('discounts/WELCOME15');
    await page.getByText('Generate unique codes').click();
    await page.getByLabel('How many').fill('25');
    const text = await downloadText(() => button('Download codes'));
    const codes = text.trim().split(/\r?\n/).slice(1);
    assert.equal(codes.length, 25);
    assert.equal(new Set(codes).size, 25);
    assert.ok(codes.every((c) => /^WELCOME15-[A-HJ-NP-Z2-9]{8}$/.test(c)), codes[0]);
  });

  await step('settings validate and re-run the audit', async () => {
    await go('settings');
    await page.getByLabel('Check quantities up to').fill('0');
    await button('Save settings');
    await page.getByText('Enter a number from 1 to 20').waitFor();
    await page.getByLabel('Check quantities up to').fill('3');
    await page.getByLabel('What free shipping costs you').fill('0');
    await button('Save settings');
    await toast('Settings saved');
    await go('audit');
    await heading('1 product sells below cost');
    await go('settings');
    await page.getByLabel('What free shipping costs you').fill('8');
    await button('Save settings');
    await toast('Settings saved');
  });

  let backup = '';
  await step('backup and report download', async () => {
    await page.locator('.store-menu summary').click();
    backup = await downloadText(() => button('Back up'));
    assert.equal(JSON.parse(backup).format, 'discount-audit');
    await page.locator('.store-menu summary').click();
    const report = await downloadText(() => button('Download report'));
    assert.ok(report.includes('Winter jacket') && !report.includes('<script'));
  });

  await step('the menu closes on Escape and returns focus', async () => {
    const summary = page.locator('.store-menu summary');
    await summary.click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.store-menu[open]').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'SUMMARY');
  });

  await step('import names the bad line and changes nothing', async () => {
    await go('import');
    await button('Review import');
    await page.getByText('Choose your products file').waitFor();
    await page.locator('#import-products').setInputFiles(csv('products.csv', PRODUCTS_TEMPLATE.replace('100.00,65.00', 'oops,65.00')));
    await page.locator('#import-discounts').setInputFiles(csv('discounts.csv', DISCOUNTS_TEMPLATE));
    await button('Review import');
    await page.getByText('products.csv, line 2').waitFor();
  });

  await step('import previews, replaces and audits', async () => {
    await page.locator('#import-products').setInputFiles(csv('products.csv', PRODUCTS_TEMPLATE));
    await button('Review import');
    await heading('Ready to import 2 products and 3 discounts');
    await button('Replace and audit');
    await heading('1 product sells below cost');
    await page.locator('.store-card', { hasText: 'My store' }).waitFor();
  });

  await step('a backup restores', async () => {
    await go('import');
    await page.getByText('Restore a backup').click();
    await page.locator('#restore').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
    await toast('Backup restored');
    await heading('2 products sell below cost');
  });

  await step('a Shopify connection hands its store to Import, which audits it', async () => {
    // The Worker's callback page leaves this in session storage. Images are dropped so the test makes no outside requests.
    const result = fromShopify(JSON.parse(readFileSync(join(root, 'packages/core/test/shopify-fixture.json'), 'utf8')));
    const store = { ...result.store, variants: result.store.variants.map(({ image: _image, ...v }) => v) };
    const payload = JSON.stringify({ shop: 'example-store.myshopify.com', ...result, store });
    await page.evaluate((text) => sessionStorage.setItem('plinth-shopify', text), payload);
    await go('import');
    await heading('Ready to import 25 products and 15 discounts');
    await page.getByText('example-store.myshopify.com').waitFor();
    await page.getByText(/Buy X Get Y/).waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('plinth-shopify')), null);
    await button('Replace and audit');
    await heading('2 products sell below cost');
    await page.locator('.store-card', { hasText: 'plinth-test' }).waitFor();
  });

  await step('a refused Shopify connection explains itself', async () => {
    await page.evaluate(() => sessionStorage.setItem('plinth-shopify', JSON.stringify({ error: 'Shopify access wasn’t approved, so nothing was read.' })));
    await go('home');
    await go('import');
    await page.getByText('Shopify access wasn’t approved').waitFor();
  });

  await step('templates and the agent copy download', async () => {
    await go('import');
    await page.getByText('Get the spreadsheet templates').click();
    assert.equal(await downloadText(() => button('Download products template')), PRODUCTS_TEMPLATE);
    await go('agent');
    assert.ok(JSON.parse(await downloadText(() => button('Download audit'))).store);
  });

  await step('500 products import, audit and explain quickly', async () => {
    let products = 'id,title,price,cost,collections\n';
    for (let i = 0; i < 500; i++) {
      const price = 30 + (i % 90);
      products += `p${i},Product ${i},${price}.00,${Math.round(price * (0.3 + (i % 7) / 20))}.00,Group ${i % 6}\n`;
    }
    let discounts = 'code,class,type,percent,applies_to,combines_with,tags,accepts_tags\n';
    for (let i = 0; i < 15; i++) {
      const cls = i === 0 ? 'shipping' : i < 4 ? 'order' : 'product';
      const type = i === 0 ? 'free_shipping' : 'percent';
      const scope = i < 4 ? 'all' : `collection:Group ${i % 6};collection:Group ${(i + 1) % 6}`;
      discounts += `D${i},${cls},${type},${i === 0 ? '' : 5 + (i % 4) * 3},${scope},product;order;shipping,t,t\n`;
    }
    await go('import');
    await page.locator('#import-products').setInputFiles(csv('products.csv', products));
    await page.locator('#import-discounts').setInputFiles(csv('discounts.csv', discounts));
    await page.getByLabel('This store is on Shopify Plus').check();
    await button('Review import');
    await heading('Ready to import 500 products and 15 discounts');
    let start = Date.now();
    await button('Replace and audit');
    await page.getByRole('heading', { name: /products sell below cost/ }).waitFor({ timeout: 30_000 });
    const auditMs = Date.now() - start;
    start = Date.now();
    await page.locator('main .rows a.row').first().click();
    await page.locator('#preview-toggle').waitFor({ timeout: 30_000 });
    const explainMs = Date.now() - start;
    start = Date.now();
    await page.locator('.store-menu summary').click();
    const [file] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), button('Download report')]);
    await file.path();
    console.log(`     import and audit ${auditMs}ms, explain ${explainMs}ms, report ${Date.now() - start}ms`);
    assert.ok(auditMs < 10_000, `import and audit ${auditMs}ms`);
    assert.ok(explainMs < 5_000, `explain ${explainMs}ms`);
  });

  await step('the sample loads again', async () => {
    await go('settings');
    await button('Load sample store');
    await toast('Sample store loaded');
    await go('home');
    await page.getByText('Winter jacket loses $5.00').waitFor();
    await button('Dismiss message');
  });

  await step('the sidebar collapses and expands', async () => {
    await button('Collapse sidebar');
    assert.ok((await page.locator('.sidebar').boundingBox())!.width < 90);
    await page.getByRole('link', { name: 'Products', exact: true }).click();
    await heading('Products');
    await button('Expand sidebar');
  });

  await step('keyboard reaches everything with a visible focus ring', async () => {
    await page.goto(`${url}#home`);
    await page.reload();
    await page.locator('.ledger-row').first().waitFor();
    const seen: string[] = [];
    const bare: string[] = [];
    for (let i = 0; i < 34; i++) {
      await page.keyboard.press('Tab');
      const at = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const ringed = el.id === 'promotion' ? el.closest('.launch-field')! : el;
        const style = getComputedStyle(ringed);
        return {
          name: el.id || el.getAttribute('aria-label') || el.textContent!.trim().slice(0, 30) || el.tagName,
          ring: el === document.body || (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0),
        };
      });
      seen.push(at.name);
      if (!at.ring) bare.push(at.name);
    }
    assert.equal(seen[0], 'Skip to content');
    for (const must of ['search', 'promotion', 'Check promotion', 'Connect an AI agent']) assert.ok(seen.includes(must), must);
    assert.ok(seen.some((name) => name.includes('Winter jacket loses')), 'ledger rows');
    assert.deepEqual(bare, []);
  });

  // Every screen, at every width: accessibility rules, reflow, target size.
  const screens = [
    'home', 'audit', 'product/jacket', 'product/gift-box', 'product/wool-cap', 'product/missing', 'products',
    'discounts', 'discounts/BOOT20', 'discounts/:new', 'calendar', 'history', 'checklist', 'import', 'settings', 'agent',
  ];
  // 640x400 is a 1280x800 window at 200% zoom.
  const sizes = [[1440, 900], [1024, 768], [901, 700], [768, 1024], [640, 400], [375, 812], [320, 640]] as const;

  for (const [width, height] of sizes) {
    await step(`every screen passes at ${width}x${height}`, async () => {
      await page.setViewportSize({ width, height });
      const found: string[] = [];
      for (const screen of screens) {
        await go(screen);
        if (screen === 'product/jacket') await page.locator('#fix-title').waitFor();
        await page.evaluate(() => document.querySelectorAll('main details').forEach((d) => ((d as HTMLDetailsElement).open = true)));
        await page.evaluate(`window.axe || (()=>{${axeSource}})()`);
        const axe = await page.evaluate(async () => {
          const result = await (window as any).axe.run(document, {
            runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
          });
          return result.violations.map((v: any) => `${v.id} ${v.nodes[0].target} ${v.nodes[0].failureSummary?.split('\n')[1] ?? ''}`);
        });
        const layout = await page.evaluate(() => {
          const issues: string[] = [];
          if (document.documentElement.scrollWidth > innerWidth) issues.push('page scrolls sideways');
          for (const box of document.querySelectorAll<HTMLElement>('main, .main-panel, .side-scroll, .card, .row, .topbar')) {
            if (box.getClientRects().length && box.scrollWidth > box.clientWidth + 1) issues.push(`overflow in ${box.className || box.tagName}`);
          }
          for (const el of document.querySelectorAll<HTMLElement>('button, a[href], input, select, summary')) {
            if (!el.getClientRects().length || el.closest('.sr, .skip')) continue;
            const target = el.closest('label.check') ?? el;
            const { width, height } = target.getBoundingClientRect();
            // Links inside a sentence are exempt from the target-size rule.
            if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue;
            if (width < 24 || height < 24) issues.push(`small target ${el.textContent?.slice(0, 24) || el.id}`);
          }
          return [...new Set(issues)];
        });
        for (const issue of [...axe, ...layout]) found.push(`${screen}: ${issue}`);
        if (shots && [1440, 901, 375, 320].includes(width)) {
          await page.screenshot({ path: join(shots, `${screen.replace(/[/:]/g, '-')}-${width}.png`), fullPage: width < 901 });
        }
      }
      assert.deepEqual(found, []);
    });
  }

  await step('the phone menu opens, navigates and closes', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await go('home');
    await button('Open menu');
    await page.getByRole('link', { name: 'Discounts', exact: true }).click();
    await heading('Discounts');
    await page.getByRole('button', { name: 'Open menu' }).waitFor();
  });

  await step('no console errors, policy violations or outside requests', async () => {
    assert.deepEqual([...new Set(problems)], []);
  });
} finally {
  await context.close();
  server?.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
