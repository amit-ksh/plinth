import ArrowUp02Icon from '@hugeicons/core-free-icons/ArrowUp02Icon';
import CheckmarkCircle02Icon from '@hugeicons/core-free-icons/CheckmarkCircle02Icon';
import DropletIcon from '@hugeicons/core-free-icons/DropletIcon';
import HelpCircleIcon from '@hugeicons/core-free-icons/HelpCircleIcon';
import Search01Icon from '@hugeicons/core-free-icons/Search01Icon';
import ShieldCheckIcon from '@hugeicons/core-free-icons/ShieldCheckIcon';
import SquareLock02Icon from '@hugeicons/core-free-icons/SquareLock02Icon';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Discount, VariantAudit } from '../../../../packages/core/src/types.ts';
import type { PromotionCheck } from '../../../../packages/core/src/workspace.ts';
import { productHref, useApp } from '../context.ts';
import { DiscountForm, summarize } from '../DiscountForm.tsx';
import { call, explainError } from '../engine.ts';
import { Disclosure, Icon, Issues, plural } from '../ui.tsx';

interface Result {
  discount: Discount;
  matchedScope: boolean;
  check: PromotionCheck;
}

const perItem = (v: VariantAudit) => (v.worst!.net - v.worst!.cost) / v.worst!.qty;

function Suggestions() {
  const { data, money } = useApp();
  const leaks = data.audit.variants.filter((v) => v.state === 'leak').sort((a, b) => perItem(a) - perItem(b));
  const unknown = data.audit.variants.filter((v) => v.state === 'unknown');
  const cards = leaks.slice(0, unknown.length ? 2 : 3);

  return (
    <div className="suggestions">
      {cards.map((v) => (
        <a className="suggestion leak" href={productHref(v.id)} key={v.id}>
          <Icon icon={DropletIcon} />
          <strong>{v.title} loses {money(v.worst!.cost - v.worst!.net)}</strong>
          <span className="sub muted">See why, and fix it</span>
        </a>
      ))}
      {unknown.length > 0 && (
        <a className="suggestion unknown" href={unknown.length === 1 ? productHref(unknown[0].id) : '#audit'}>
          <Icon icon={HelpCircleIcon} />
          <strong>
            {unknown.length === 1 ? unknown[0].title : plural(unknown.length, { one: '{n} product', other: '{n} products' })}
          </strong>
          <span className="sub muted">
            {unknown.every((v) => v.unknown[0] === 'missing_cost') ? 'Add a cost to check it' : 'Can’t be sure yet'}
          </span>
        </a>
      )}
      {cards.length + (unknown.length ? 1 : 0) < 3 && (
        <a className="suggestion" href="#products">
          <Icon icon={CheckmarkCircle02Icon} />
          <strong>
            {plural(data.audit.counts.clear_in_model, { one: '{n} product with no leak', other: '{n} products with no leak' })}
          </strong>
          <span className="sub muted">See every product</span>
        </a>
      )}
    </div>
  );
}

export function Home() {
  const { data, change, money } = useApp();
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
    <div className="hero">
      <div className="intro">
        <span className="trust">
          <Icon icon={ShieldCheckIcon} size={15} />
          Every possible discount stack, checked on your device
        </span>
        <h1 tabIndex={-1}>What are you launching next?</h1>
        <p className="muted">Describe a promotion. See whether it would sell anything below cost before it goes live.</p>
      </div>

      <form className="section" onSubmit={submit}>
        <div className="composer">
          <div className="composer-input">
            <Icon icon={Search01Icon} />
            <label className="sr" htmlFor="promotion">Describe a promotion</label>
            <textarea
              id="promotion"
              name="promotion"
              ref={box}
              value={text}
              rows={3}
              autoComplete="off"
              placeholder="20% off winter, or free shipping over $50"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'promotion-error' : undefined}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </div>
          <div className="composer-foot">
            <span className="composer-pill">
              <Icon icon={SquareLock02Icon} size={16} />
              Costs never leave this device
            </span>
            <button className="btn primary round" type="submit" aria-label="Check promotion" aria-disabled={busy || undefined}>
              <Icon icon={ArrowUp02Icon} size={20} strong />
            </button>
          </div>
        </div>
        {error && <p className="error" id="promotion-error">{error}</p>}
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
                  if (await change(() => call('saveDiscount', result.discount), `${result.discount.id} added to this audit`)) reset();
                }}
              >
                Add to this audit
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
      ) : (
        <>
          <Suggestions />
          <ul className="dots" aria-label="This audit">
            <li>{plural(data.store.variants.length, { one: '{n} product', other: '{n} products' })}</li>
            <li>{plural(data.store.discounts.length, { one: '{n} discount', other: '{n} discounts' })}</li>
            <li>{data.app.sample ? 'Sample data' : 'Nothing uploaded'}</li>
          </ul>
        </>
      )}
    </div>
  );
}
