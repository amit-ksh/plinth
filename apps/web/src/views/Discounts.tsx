import Add01Icon from '@hugeicons/core-free-icons/Add01Icon';
import Delete02Icon from '@hugeicons/core-free-icons/Delete02Icon';
import DiscountTag01Icon from '@hugeicons/core-free-icons/DiscountTag01Icon';
import Layers01Icon from '@hugeicons/core-free-icons/Layers01Icon';
import PlayIcon from '@hugeicons/core-free-icons/PlayIcon';
import StopCircleIcon from '@hugeicons/core-free-icons/StopCircleIcon';
import { useEffect, useRef, useState } from 'react';
import { TEMPLATES, type Template } from '../../../../packages/core/src/templates.ts';
import type { Discount } from '../../../../packages/core/src/types.ts';
import type { PromotionCheck } from '../../../../packages/core/src/workspace.ts';
import { productHref, useApp } from '../context.ts';
import { amountOf, DiscountForm, summarize, targetOf } from '../DiscountForm.tsx';
import { call, explainError } from '../engine.ts';
import { Icon, Issues, Page, plural } from '../ui.tsx';
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

/** Shown when a save would put products below cost. Saving anyway is allowed; it's the merchant's call. */
function Guard({ check, onSave, onBack, saveLabel }: { check: PromotionCheck; onSave: () => void; onBack: () => void; saveLabel: string }) {
  const { money } = useApp();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  return (
    <section className="card leak" aria-labelledby="guard-title">
      <h2 id="guard-title" tabIndex={-1} ref={title}>
        {plural(check.leaks.length, { one: 'This would sell {n} product below cost', other: 'This would sell {n} products below cost' })}
      </h2>
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
      {check.leaks.length > 5 && <p className="caption">Showing the 5 biggest losses of {check.leaks.length}.</p>}
      <p>Turn off a combination, lower the amount or narrow what it applies to, then save again.</p>
      <div className="actions">
        <button className="btn primary" onClick={onBack}>Change it</button>
        <button className="btn" onClick={onSave}>{saveLabel}</button>
      </div>
    </section>
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
      if (result.leaks.length) {
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
