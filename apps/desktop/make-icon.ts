// Renders the Plinth mark to a 1024px PNG for `npm run icons -w @app/desktop`.
import { chromium } from 'playwright-core';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="1024" height="1024"><rect width="32" height="32" rx="7" fill="#02251a"/><g transform="translate(6 6)" fill="#f8eee5"><rect x="7" y="2.5" width="6" height="7" rx="1"/><rect x="4.5" y="10.5" width="11" height="2.75" rx="1"/><rect x="2.5" y="14.25" width="15" height="3.25" rx="1"/></g></svg>`;
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.locator('svg').screenshot({ path: new URL('./icon.png', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), omitBackground: true });
await browser.close();
