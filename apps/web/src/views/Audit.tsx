import ArrowRight01Icon from '@hugeicons/core-free-icons/ArrowRight01Icon';
import { UNKNOWN_TEXT } from '../../../../packages/core/src/format.ts';
import type { State, VariantAudit } from '../../../../packages/core/src/types.ts';
import { productHref, useApp } from '../context.ts';
import { Disclosure, Icon, Page, plural, STATE } from '../ui.tsx';

function Row({ row }: { row: VariantAudit }) {
  const { money } = useApp();
  const worst = row.worst;
  let why: string;
  if (row.state === 'leak') {
    why = worst!.stack.length
      ? plural(worst!.stack.length, { one: '{n} discount on its own', other: '{n} discounts stacked together' })
      : 'Priced below cost';
  } else if (row.state === 'unknown') why = UNKNOWN_TEXT[row.unknown[0]];
  else why = worst ? `Worst case keeps ${money(worst.net - worst.cost)} of profit` : '';

  return (
    <li>
      <a className="row" href={productHref(row.id)}>
        <span className={`dot-icon ${row.state}`}><Icon icon={STATE[row.state].icon} /></span>
        <span className="body">
          <strong>{row.title}</strong>
          <span className="caption muted">{why}</span>
        </span>
        <span className="end">
          {row.state === 'leak' && <span className="danger-text num">Loses {money(worst!.cost - worst!.net)}</span>}
          <Icon icon={ArrowRight01Icon} />
        </span>
      </a>
    </li>
  );
}

export function Audit() {
  const { data, money } = useApp();
  const { variants, counts } = data.audit;
  const { maxQty, shippingCost } = data.app.settings;
  const margin = (v: VariantAudit) => (v.worst ? (v.worst.net - v.worst.cost) / v.worst.qty : 0);
  const of = (state: State) => variants.filter((v) => v.state === state).sort((a, b) => margin(a) - margin(b));

  const clear = counts.clear_in_model;

  return (
    <Page
      title={counts.leak ? plural(counts.leak, { one: '{n} product sells below cost', other: '{n} products sell below cost' }) : 'No leaks found'}
      lead={plural(variants.length, {
        one: '{n} product checked against every discount stack a customer could use.',
        other: '{n} products checked against every discount stack a customer could use.',
      })}
    >
      {counts.leak > 0 && (
        <section className="section" aria-labelledby="leaks">
          <h2 id="leaks">Fix these first</h2>
          <ul className="rows">{of('leak').map((v) => <Row row={v} key={v.id} />)}</ul>
        </section>
      )}
      {counts.unknown > 0 && (
        <section className="section" aria-labelledby="unknown">
          <h2 id="unknown">Can’t be sure</h2>
          <ul className="rows">{of('unknown').map((v) => <Row row={v} key={v.id} />)}</ul>
        </section>
      )}
      {counts.thin > 0 && (
        <section className="section" aria-labelledby="thin">
          <h2 id="thin">Thin margin</h2>
          <ul className="rows">{of('thin').map((v) => <Row row={v} key={v.id} />)}</ul>
        </section>
      )}
      <div className="section">
        {clear > 0 && (
          <a className="row" href="#products">
            <span className="dot-icon"><Icon icon={STATE.clear_in_model.icon} /></span>
            <span className="body">
              <strong>{plural(clear, { one: '{n} product with no leak', other: '{n} products with no leak' })}</strong>
              <span className="caption muted">See all products</span>
            </span>
            <span className="end"><Icon icon={ArrowRight01Icon} /></span>
          </a>
        )}
        <Disclosure summary="What this check assumes">
          <ul className="facts">
            <li>One product in the cart, bought {maxQty === 1 ? 'one at a time' : `1–${maxQty} at a time`}.</li>
            <li>Free shipping costs you {money(shippingCost)}.</li>
            <li>The combination rules are modeled and not yet tested on a Shopify checkout.</li>
            <li>Taxes, payment fees, returns, markets and mixed carts are left out.</li>
          </ul>
          <a href="#settings">Change these settings</a>
        </Disclosure>
      </div>
    </Page>
  );
}
