import Add01Icon from '@hugeicons/core-free-icons/Add01Icon';
import Delete02Icon from '@hugeicons/core-free-icons/Delete02Icon';
import DiscountTag01Icon from '@hugeicons/core-free-icons/DiscountTag01Icon';
import Layers01Icon from '@hugeicons/core-free-icons/Layers01Icon';
import Download01Icon from '@hugeicons/core-free-icons/Download01Icon';
import PauseIcon from '@hugeicons/core-free-icons/PauseIcon';
import PlayIcon from '@hugeicons/core-free-icons/PlayIcon';
import StopCircleIcon from '@hugeicons/core-free-icons/StopCircleIcon';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { generateCodes, MAX_BULK_CODES } from '../../../../packages/core/src/shopify-write.ts';
import { TEMPLATES, type Template } from '../../../../packages/core/src/templates.ts';
import type { Discount } from '../../../../packages/core/src/types.ts';
import type { PromotionCheck } from '../../../../packages/core/src/workspace.ts';
import { productHref, useApp } from '../context.ts';
import { amountOf, DiscountForm, summarize, targetOf } from '../DiscountForm.tsx';
import { call, explainError } from '../engine.ts';
import { Disclosure, download, Icon, Issues, Page, plural } from '../ui.tsx';
import { useWriter } from '../writer.ts';

// A colon can't be confused with a real code someone typed, because codes shown here come from the store.
const NEW = ':new';

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const CLASS_NAME = { product: 'Product', order: 'Order', shipping: 'Shipping' } as const;

const blank = (): Discount => ({
  id: '', title: '', class: 'product', method: 'code', bps: 0, off: 0, allVariants: true, variants: [], collections: [],
  minSubtotal: 0, combinesWith: [], tags: [], acceptsTags: [], starts: null, ends: null, supported: true,
});

const statusOf = (d: Discount, now: number) =>
  !d.supported ? 'unsure' : d.ends !== null && d.ends <= now ? 'ended' : d.starts !== null && d.starts > now ? 'scheduled' : 'active';
const STATUS = { unsure: ['unknown', 'Can’t be sure'], ended: ['off', 'Ended'], scheduled: ['off', 'Scheduled'], active: ['on', 'Active'] } as const;

function Templates({ onPick }: { onPick: (template: Template | null) => void }) {
  return (
    <div className="section">
      <ul className="templates" aria-label="Templates">
        {TEMPLATES.map((t) => (
          <li key={t.id}>
            <button className="template" onClick={() => onPick(t)}>
              <strong>{t.name}</strong>
              <span>{t.use}</span>
              <span className="caption muted">{t.why}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button className="btn with-icon" onClick={() => onPick(null)}>
          <Icon icon={Add01Icon} />
          Start from scratch
        </button>
      </div>
    </div>
  );
}

/** Shown when a save breaks a guardrail: below cost, or below a margin floor. Block mode refuses the save. */
function Guard({ check, onSave, onBack, saveLabel }: { check: PromotionCheck; onSave: () => void; onBack: () => void; saveLabel: string }) {
  const { money } = useApp();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;
  const margin = (net: number, cost: number) => pct(Math.round(((net - cost) * 10000) / net));
  const heading = check.leaks.length
    ? plural(check.leaks.length, { one: 'This would sell {n} product below cost', other: 'This would sell {n} products below cost' })
    : plural(check.belowFloor.length, { one: 'This would take {n} product below its minimum margin', other: 'This would take {n} products below their minimum margin' });
  return (
    <section className={`card ${check.leaks.length ? 'leak' : 'unknown'}`} aria-labelledby="guard-title">
      <h2 id="guard-title" tabIndex={-1} ref={title}>{heading}</h2>
      {check.leaks.length > 0 && (
        <ul className="rows">
          {check.leaks.slice(0, 5).map(({ id, title: name, outcome }) => (
            <li key={id}>
              <a className="row" href={productHref(id)}>
                <span className="body">
                  <strong>{name}</strong>
                  <span className="caption code">{outcome.stack.join(' + ')}</span>
                </span>
                <span className="end danger-text num">Loses {money(outcome.cost - outcome.net)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {check.leaks.length > 5 && <p className="caption">Showing the 5 biggest losses of {check.leaks.length}.</p>}
      {check.belowFloor.length > 0 && (
        <>
          {check.leaks.length > 0 && (
            <h3>{plural(check.belowFloor.length, { one: '{n} more product drops below its minimum margin', other: '{n} more products drop below their minimum margin' })}</h3>
          )}
          <ul className="rows">
            {check.belowFloor.slice(0, 5).map(({ id, title: name, outcome, floorBps }) => (
              <li key={id}>
                <a className="row" href={productHref(id)}>
                  <span className="body">
                    <strong>{name}</strong>
                    <span className="caption code">{outcome.stack.join(' + ')}</span>
                  </span>
                  <span className="end num">{margin(outcome.net, outcome.cost)} margin, minimum {pct(floorBps)}</span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      <p>
        {check.blocked
          ? 'Your guardrails block this change. Turn off a combination, lower the amount or narrow what it applies to. Guardrails are in Settings.'
          : 'Turn off a combination, lower the amount or narrow what it applies to, then save again.'}
      </p>
      <div className="actions">
        <button className="btn primary" onClick={onBack}>Change it</button>
        {!check.blocked && <button className="btn" onClick={onSave}>{saveLabel}</button>}
      </div>
    </section>
  );
}

/** Unique single-use style codes for a code discount: downloaded as CSV, and added to Shopify when linked. */
function UniqueCodes({ discount }: { discount: Discount }) {
  const writer = useWriter();
  const { notify } = useApp();
  const [count, setCount] = useState('100');
  const [prefix, setPrefix] = useState(discount.id.slice(0, 20));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const uid = useId();

  const make = async (event: FormEvent) => {
    event.preventDefault();
    const n = /^\d+$/.test(count.trim()) ? Number(count) : 0;
    if (n < 1 || n > MAX_BULK_CODES) {
      setError(`Choose from 1 to ${MAX_BULK_CODES} codes`);
      document.getElementById(`${uid}-count`)?.focus();
      return;
    }
    setError('');
    setBusy(true);
    try {
      const codes = generateCodes(prefix, n);
      if (writer.linked) {
        const queued = await writer.addCodes(discount, codes);
        notify(`${queued} codes added to ${discount.id} in Shopify and downloaded`);
      } else {
        notify(`${codes.length} codes downloaded. Add them to ${discount.id} in Shopify`);
      }
      download(`${discount.id}-codes.csv`, `code\n${codes.join('\n')}\n`, 'text/csv');
    } catch (e) {
      setError(explainError(e).join('. '));
    }
    setBusy(false);
  };

  return (
    <Disclosure summary="Generate unique codes">
      <form className="form" onSubmit={make} noValidate>
        <p className="muted">
          Each code works like {discount.id}, with the same amount and combination settings, so the leak check above covers them.
          {writer.linked ? ' They are added to this discount in Shopify.' : ''}
        </p>
        <div className="fields">
          <div className="field">
            <label htmlFor={`${uid}-count`}>How many</label>
            <input id={`${uid}-count`} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} aria-invalid={!!error || undefined} aria-describedby={error ? `${uid}-error` : undefined} />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-prefix`}>Starts with (optional)</label>
            <input id={`${uid}-prefix`} autoComplete="off" spellCheck={false} value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          </div>
        </div>
        {error && <p className="error" id={`${uid}-error`}>{error}</p>}
        <div className="actions">
          <button className="btn with-icon" type="submit" aria-disabled={busy || undefined}>
            <Icon icon={Download01Icon} />
            {writer.linked ? 'Add to Shopify and download' : 'Download codes'}
          </button>
        </div>
      </form>
    </Disclosure>
  );
}

function Editor({ id }: { id: string }) {
  const { data, money } = useApp();
  const writer = useWriter();
  const adding = id === NEW;
  const existing = data.store.discounts.find((d) => d.id === id);
  const back = { href: '#discounts', label: 'Discounts' };
  const [template, setTemplate] = useState<Template | null | undefined>(adding ? undefined : null);
  const [draft, setDraft] = useState<Discount | null>(null);
  const [check, setCheck] = useState<PromotionCheck | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (!adding && !existing) {
    return <Page title="Discount not found" lead="It may have been removed or replaced by an import." back={back} />;
  }

  const now = Date.now();
  const saveLabel = writer.linked ? 'Save to Shopify anyway' : 'Save anyway';
  const commit = async (discount: Discount) => {
    setBusy(true);
    const done = await writer.save(discount, adding ? undefined : id);
    setBusy(false);
    if (done) location.hash = 'discounts';
  };

  const submit = async (discount: Discount) => {
    if (busy) return;
    const named = { ...discount, title: discount.title || discount.id };
    setIssues([]);
    try {
      const result = await call('checkDiscount', named, adding ? undefined : id);
      if (result.leaks.length || result.belowFloor.length) {
        setDraft(named);
        setCheck(result);
        return;
      }
      await commit(named);
    } catch (error) {
      setIssues(explainError(error));
    }
  };

  if (adding && template === undefined) {
    return (
      <Page title="Add a discount" lead="Start from a template with safe combination settings, or from scratch. Every save is checked for leaks first." back={back}>
        <Templates onPick={setTemplate} />
      </Page>
    );
  }

  const initial = draft ?? existing ?? (template ? template.build(data.store) : blank());
  const status = existing ? statusOf(existing, now) : null;
  const where = writer.linked ? `Saved to ${writer.shop} and to this audit.` : 'Saved to this audit only. Nothing is sent to Shopify.';

  return (
    <Page
      title={adding ? (template ? template.name : 'Add a discount') : id}
      lead={adding ? (template?.why ?? where) : summarize(existing!, data.store, money)}
      back={back}
    >
      <Issues issues={issues} />
      {check && draft ? (
        <Guard check={check} saveLabel={saveLabel} onBack={() => setCheck(null)} onSave={() => commit(draft)} />
      ) : (
        <div className="card">
          {adding && template && <p className="muted">{where}</p>}
          <DiscountForm
            key={`${id}:${template?.id ?? ''}:${draft ? 'draft' : ''}`}
            initial={initial}
            submitLabel={adding ? (writer.linked ? 'Create in Shopify' : 'Add discount') : writer.linked ? 'Save to Shopify' : 'Save changes'}
            onSubmit={submit}
          />
        </div>
      )}
      {existing && !check && existing.method === 'code' && existing.supported && <UniqueCodes discount={existing} />}
      {existing && !check && (
        <div className="actions">
          {status === 'ended' ? (
            <button className="btn with-icon" disabled={busy} onClick={() => writer.save({ ...existing, ends: null }, id, 'reactivate', `${id} is running again`)}>
              <Icon icon={PlayIcon} />
              Run again
            </button>
          ) : (
            <button className="btn with-icon" disabled={busy} onClick={() => writer.save({ ...existing, ends: Date.now() }, id, 'end', `${id} ended`)}>
              <Icon icon={StopCircleIcon} />
              End now
            </button>
          )}
          <button
            className="btn with-icon"
            disabled={busy}
            onClick={async () => {
              if (await writer.remove(id)) location.hash = 'discounts';
            }}
          >
            <Icon icon={Delete02Icon} />
            {writer.linked ? 'Delete from Shopify' : 'Remove from audit'}
          </button>
        </div>
      )}
    </Page>
  );
}

/** Pause all, with a confirmation, and the banner that resumes a paused batch. */
function KillSwitch() {
  const { data } = useApp();
  const writer = useWriter();
  const [confirming, setConfirming] = useState(false);
  const now = Date.now();
  const live = data.store.discounts.filter((d) => statusOf(d, now) === 'active');
  const paused = [...data.app.history].reverse().find((e) => e.action === 'pause' && e.batch && !e.rolledBack);
  const pausedCount = paused ? data.app.history.filter((e) => e.batch === paused.batch && !e.rolledBack).length : 0;

  if (paused) {
    return (
      <div className="card tinted kill" role="status">
        <p>
          <strong>{plural(pausedCount, { one: '{n} discount paused', other: '{n} discounts paused' })}</strong>{' '}
          <span className="muted">at {new Date(paused.at).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}. Customers can’t use them.</span>
        </p>
        <div className="actions">
          <button className="btn primary with-icon" onClick={() => writer.resumeAll(paused.batch!)}>
            <Icon icon={PlayIcon} />
            Resume all
          </button>
        </div>
      </div>
    );
  }
  if (!live.length) return null;
  if (confirming) {
    return (
      <div className="card unknown kill">
        <p>
          <strong>Pause {plural(live.length, { one: '{n} live discount', other: 'all {n} live discounts' })}?</strong>{' '}
          {writer.linked ? `They end now in ${writer.shop}.` : 'They end now in this audit.'} Resume all puts them back as they were.
        </p>
        <div className="actions">
          <button
            className="btn primary with-icon"
            onClick={async () => {
              setConfirming(false);
              await writer.pauseAll();
            }}
          >
            <Icon icon={PauseIcon} />
            Pause all
          </button>
          <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div className="actions">
      <button className="btn with-icon" onClick={() => setConfirming(true)}>
        <Icon icon={PauseIcon} />
        Pause all discounts
      </button>
    </div>
  );
}

export function Discounts({ id }: { id?: string }) {
  const { data, money } = useApp();
  const writer = useWriter();
  if (id) return <Editor id={id} key={id} />;
  const now = Date.now();
  const { discounts } = data.store;
  const leaksBy = new Map<string, number>();
  for (const v of data.audit.variants) {
    if (v.state !== 'leak') continue;
    for (const d of v.worst!.stack) leaksBy.set(d, (leaksBy.get(d) ?? 0) + 1);
  }

  return (
    <Page
      title="Discounts"
      wide
      lead={writer.linked ? `Every change is checked for leaks, then saved to ${writer.shop}.` : 'What each one takes off, what it combines with, and whether it’s in a losing stack.'}
      action={
        <a className="btn primary with-icon" href={`#discounts/${NEW}`}>
          <Icon icon={Add01Icon} strong />
          Add discount
        </a>
      }
    >
      {discounts.length > 0 && <KillSwitch />}
      {discounts.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Takes off</th>
                <th scope="col" className="hide-narrow">Applies to</th>
                <th scope="col" className="hide-narrow">Combines with</th>
                <th scope="col" className="hide-narrow">Leaks</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => {
                const [tone, label] = STATUS[statusOf(d, now)];
                const leaks = leaksBy.get(d.id) ?? 0;
                return (
                  <tr key={d.id}>
                    <td>
                      <a className="cell-link" href={`#discounts/${encodeURIComponent(d.id)}`}>
                        <span className="dot-icon"><Icon icon={DiscountTag01Icon} /></span>
                        <span className="cell-main">
                          <strong className="code">{d.id}</strong>
                          <span className="caption muted">{CLASS_NAME[d.class]} · {d.method === 'code' ? 'Code' : 'Automatic'}</span>
                        </span>
                      </a>
                    </td>
                    <td>{amountOf(d, money)}{d.minSubtotal ? <span className="caption muted block">over {money(d.minSubtotal)}</span> : null}</td>
                    <td className="hide-narrow">{capitalize(targetOf(d, data.store))}</td>
                    <td className="hide-narrow">
                      {d.combinesWith.length ? d.combinesWith.map((c) => CLASS_NAME[c]).join(', ') : <span className="muted">Nothing</span>}
                    </td>
                    <td className={`hide-narrow num${leaks ? ' danger-text' : ''}`}>
                      {leaks ? plural(leaks, { one: 'In {n} leak', other: 'In {n} leaks' }) : <span className="muted">None</span>}
                    </td>
                    <td><span className={`status ${tone}`}>{label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card">
          <h2>No discounts yet</h2>
          <p>Start from a template, or import the discounts running in your store.</p>
          <div className="actions">
            <a className="btn with-icon" href={`#discounts/${NEW}`}><Icon icon={Layers01Icon} />Use a template</a>
            <a className="btn" href="#import">Import discounts</a>
          </div>
        </div>
      )}
    </Page>
  );
}
