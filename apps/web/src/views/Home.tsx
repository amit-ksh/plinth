import ArrowRight01Icon from '@hugeicons/core-free-icons/ArrowRight01Icon';
import CheckmarkCircle02Icon from '@hugeicons/core-free-icons/CheckmarkCircle02Icon';
import DiscountTag01Icon from '@hugeicons/core-free-icons/DiscountTag01Icon';
import DropletIcon from '@hugeicons/core-free-icons/DropletIcon';
import HelpCircleIcon from '@hugeicons/core-free-icons/HelpCircleIcon';
import SquareLock02Icon from '@hugeicons/core-free-icons/SquareLock02Icon';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Discount, VariantAudit } from '../../../../packages/core/src/types.ts';
import type { PromotionCheck } from '../../../../packages/core/src/workspace.ts';
import { productHref, useApp } from '../context.ts';
import { DiscountForm, summarize } from '../DiscountForm.tsx';
import { call, explainError } from '../engine.ts';
import { Disclosure, Icon, Issues, plural } from '../ui.tsx';
import { useWriter } from '../writer.ts';

interface Result {
  discount: Discount;
  matchedScope: boolean;
  check: PromotionCheck;
}

const perItem = (v: VariantAudit) => (v.worst!.net - v.worst!.cost) / v.worst!.qty;
const LEDGER_ROWS = 5;

/** The answer first: what in this store is losing money right now. */
function Ledger() {
  const { data, money } = useApp();
  const leaks = data.audit.variants.filter((v) => v.state === 'leak').sort((a, b) => perItem(a) - perItem(b));
  const unknown = data.audit.variants.filter((v) => v.state === 'unknown');
  const rows = [...leaks, ...unknown];
  const shown = rows.slice(0, LEDGER_ROWS);

  if (!rows.length) {
    return (
      <a className="row" href="#products">
        <Icon icon={CheckmarkCircle02Icon} />
        <span className="body">
          <strong>{plural(data.audit.counts.clear_in_model, { one: '{n} product checked', other: '{n} products checked' })}</strong>
          <span className="caption muted">No stack in this audit sells below cost</span>
        </span>
        <span className="end"><Icon icon={ArrowRight01Icon} /></span>
      </a>
    );
  }

  return (
    <ul className="ledger" aria-label="Losing money now">
      {shown.map((v) => (
        <li key={v.id}>
          <a className={`ledger-row ${v.state}`} href={productHref(v.id)}>
            <Icon icon={v.state === 'leak' ? DropletIcon : HelpCircleIcon} />
            <span className="body">
              <strong>{v.state === 'leak' ? `${v.title} loses ${money(v.worst!.cost - v.worst!.net)}` : v.title}</strong>
              <span className="caption muted">
                {v.state === 'leak'
                  ? v.worst!.stack.length ? <span className="code">{v.worst!.stack.join(' + ')}</span> : 'Priced below cost'
                  : v.unknown[0] === 'missing_cost' ? 'Add a cost to check it' : 'Can’t be sure yet'}
              </span>
            </span>
            <span className="end caption">{v.state === 'leak' ? 'See why, and fix it' : 'Check'}<Icon icon={ArrowRight01Icon} size={16} /></span>
          </a>
        </li>
      ))}
      {rows.length > shown.length && (
        <li><a className="ledger-more" href="#audit">See all {rows.length}</a></li>
      )}
    </ul>
  );
}

export function Home() {
  const { data, money } = useApp();
  const writer = useWriter();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!result) return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'nearest' });
  }, [result]);

  const run = async (discount: Discount, matchedScope: boolean) => {
    setIssues([]);
    setBusy(true);
    try {
      setResult({ discount, matchedScope, check: await call('checkPromotion', discount) });
    } catch (e) {
      setResult(null);
      setIssues(explainError(e));
    }
    setBusy(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    try {
      const parsed = await call('parsePromotion', text);
      if (parsed.ok) {
        setError('');
        await run(parsed.discount, parsed.matchedScope);
      } else {
        setResult(null);
        setError(parsed.error);
        box.current?.focus();
      }
    } catch (e) {
      setIssues(explainError(e));
    }
  };

  const reset = () => {
    setResult(null);
    setText('');
    box.current?.focus();
  };

  const check = result?.check;

  return (
    <div className="home">
      <header className="home-head">
        <p className="eyebrow">
          {data.app.settings.storeName} · {plural(data.store.variants.length, { one: '{n} product', other: '{n} products' })} · {plural(data.store.discounts.length, { one: '{n} discount', other: '{n} discounts' })}{data.app.sample ? ' · Sample data' : ''}
        </p>
        <h1 tabIndex={-1}>
          {data.audit.counts.leak
            ? plural(data.audit.counts.leak, { one: '{n} product sells below cost', other: '{n} products sell below cost' })
            : 'No leak found in this audit'}
        </h1>
        <p className="muted">
          {data.audit.counts.leak
            ? 'When these discounts stack at checkout, the order earns less than the product cost.'
            : 'Check your next promotion before it goes live.'}
        </p>
      </header>

      <Ledger />

      <form className="launch" onSubmit={submit}>
        <h2 className="launch-title">Check a promotion before it goes live</h2>
        <div className="launch-field">
          <Icon icon={DiscountTag01Icon} />
          <label className="sr" htmlFor="promotion">Describe a promotion</label>
          <textarea
            id="promotion"
            name="promotion"
            ref={box}
            value={text}
            rows={1}
            autoComplete="off"
            placeholder={`20% off winter, or free shipping over ${money(5000)}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'promotion-error' : 'promotion-note'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button className="btn primary" type="submit" aria-disabled={busy || undefined}>Check promotion</button>
        </div>
        {error
          ? <p className="error" id="promotion-error">{error}</p>
          : <p className="caption muted launch-note" id="promotion-note"><Icon icon={SquareLock02Icon} size={14} />Checked on this device. Costs never leave it.</p>}
      </form>

      <Issues issues={issues} />

      {result && check ? (
        <div className="section">
          <section className={`card ${check.leaks.length ? 'leak' : check.newlyUnknown.length ? 'unknown' : 'tinted'}`} aria-labelledby="check-result">
            <h2 id="check-result" tabIndex={-1} ref={heading}>
              {check.leaks.length
                ? plural(check.leaks.length, { one: 'This would sell {n} product below cost', other: 'This would sell {n} products below cost' })
                : check.newlyUnknown.length
                  ? 'Too many discounts would stack to check this fully'
                  : 'No leak found with this promotion'}
            </h2>
            <p>{summarize(result.discount, data.store, money)}</p>
            {!result.matchedScope && (
              <p className="caption">No product or collection matched, so this assumes every product. Change it below if that’s wrong.</p>
            )}
            {check.leaks.length > 0 && (
              <ul className="rows">
                {check.leaks.slice(0, 6).map(({ id, title, outcome }) => (
                  <li className="row" key={id}>
                    <span className="body">
                      <strong>{title}</strong>
                      <span className="caption code">{outcome.stack.join(' + ')}</span>
                    </span>
                    <span className="end danger-text num">Loses {money(outcome.cost - outcome.net)}</span>
                  </li>
                ))}
              </ul>
            )}
            {check.leaks.length > 6 && <p className="caption">Showing the 6 biggest losses of {check.leaks.length}.</p>}
            <div className="actions">
              <button className="btn" onClick={reset}>Check another</button>
              <button
                className="btn"
                onClick={async () => {
                  if (await writer.save(result.discount, undefined, 'create', `${result.discount.id} added to ${writer.place}`)) reset();
                }}
              >
                {writer.linked ? 'Create in Shopify' : 'Add to this audit'}
              </button>
            </div>
          </section>
          <Disclosure summary="Change what we understood">
            <DiscountForm
              key={JSON.stringify(result.discount)}
              initial={result.discount}
              submitLabel="Check again"
              onSubmit={(discount) => run(discount, true)}
            />
          </Disclosure>
        </div>
      ) : null}
    </div>
  );
}
