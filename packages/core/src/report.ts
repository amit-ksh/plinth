import type { AppState } from './app-state.ts';
import type { Fix } from './fixes.ts';
import { describeChange, formatMoney, UNKNOWN_TEXT } from './format.ts';
import type { AuditResult, PairRule } from './types.ts';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

export interface ReportInput {
  productName: string;
  app: AppState;
  audit: AuditResult;
  /** The recommended fix and the pair rules, by product. */
  details: Map<string, { fix?: Fix; pairs: PairRule[] }>;
  now: number;
}

/** One self-contained HTML file: no scripts and no external requests. */
export function buildReport({ productName, app, audit, details, now }: ReportInput): string {
  const { settings } = app;
  const money = (minor: number) => esc(formatMoney(minor, settings.currency));
  const of = (state: string) => audit.variants.filter((v) => v.state === state);

  const leaks = of('leak').map((v) => {
    const worst = v.worst!;
    const detail = details.get(v.id);
    const pairs = detail?.pairs.map((p) => `<li>${esc(p.left)} + ${esc(p.right)}: ${esc(p.rule)}</li>`).join('') ?? '';
    const steps = detail?.fix?.changes.map((c) => `<li>${esc(describeChange(c).setting)}</li>`).join('') ?? '';
    return `<section>
<h3>${esc(v.title)} <span class="loss">loses ${money(worst.cost - worst.net)} per order</span></h3>
<p>${esc(worst.stack.join(' + ') || 'List price')} at quantity ${worst.qty}. You keep ${money(worst.net)}. It costs ${money(worst.cost)}.</p>
${pairs ? `<p>Why these combine:</p><ul>${pairs}</ul>` : ''}
${steps ? `<p>Change in Shopify:</p><ol>${steps}</ol>` : '<p>Raise the price or lower the cost.</p>'}
</section>`;
  });

  const unknown = of('unknown').map((v) => `<li>${esc(v.title)}: ${esc(v.unknown.map((u) => UNKNOWN_TEXT[u]).join(' '))}</li>`);
  const thin = of('thin').map((v) => `<li>${esc(v.title)}</li>`);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Discount audit: ${esc(settings.storeName)}</title>
<style>
body{max-width:760px;margin:0 auto;padding:40px 20px;font:16px/1.55 system-ui,sans-serif;color:#10231B;overflow-wrap:break-word}
h1,h2,h3{line-height:1.25}
h2{margin-top:36px}
section{break-inside:avoid;margin-block:20px;padding:4px 20px;border:1px solid #D8DDD7;border-radius:14px}
.loss{color:#A3262A}
.note{color:#4F5E57}
</style></head><body>
<h1>Discount audit: ${esc(settings.storeName)}</h1>
<p class="note">${esc(new Date(now).toISOString().slice(0, 10))} by ${esc(productName)}${app.sample ? ', sample data' : ''}</p>
<p>${audit.variants.length} products checked. Selling below cost: ${audit.counts.leak}. Can’t be sure: ${audit.counts.unknown}. Thin margin: ${audit.counts.thin}. No leak found: ${audit.counts.clear_in_model}.</p>
<h2>Selling below cost</h2>
${leaks.join('\n') || '<p>None found in the modeled rules.</p>'}
${unknown.length ? `<h2>Can’t be sure</h2><ul>${unknown.join('')}</ul>` : ''}
${thin.length ? `<h2>Thin margin</h2><ul>${thin.join('')}</ul>` : ''}
<h2>What this assumes</h2>
<ul>
<li>One product per cart, quantity 1 to ${settings.maxQty}.</li>
<li>Free shipping costs the store ${money(settings.shippingCost)}.</li>
<li>Combination rules and arithmetic are modeled and not yet verified against a Shopify checkout.</li>
<li>Taxes, payment fees, returns, markets, customer segments and mixed carts are not included.</li>
</ul>
<p class="note">Decision support only. Place a test order before you rely on it.</p>
</body></html>
`;
}
