import Add01Icon from '@hugeicons/core-free-icons/Add01Icon';
import Link01Icon from '@hugeicons/core-free-icons/Link01Icon';
import Undo02Icon from '@hugeicons/core-free-icons/Undo02Icon';
import ViewIcon from '@hugeicons/core-free-icons/ViewIcon';
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { describeChange, parseMoney, UNKNOWN_TEXT } from '../../../../packages/core/src/format.ts';
import { changeId, type Fix } from '../../../../packages/core/src/fixes.ts';
import type { Explained, ProductDetail } from '../../../../packages/core/src/workspace.ts';
import { editable, useApp } from '../context.ts';
import { call, explainError } from '../engine.ts';
import { Disclosure, Icon, Issues, Page, plural, StateBadge } from '../ui.tsx';

const KIND = { price: '', product: 'product', order: 'order', shipping: 'you pay shipping' } as const;

function Receipt({ explained }: { explained: Explained }) {
  const { money } = useApp();
  const { outcome, lines } = explained;
  const margin = outcome.net - outcome.cost;
  return (
    <>
      {outcome.stack.length > 0 && (
        <p className="stack">
          {lines.slice(1).map(({ label: code }, i) => (
            <Fragment key={code}>
              {i > 0 && <span aria-hidden="true">+</span>}
              <span className="chip">{code}</span>
            </Fragment>
          ))}
        </p>
      )}
      <dl className="receipt">
        {lines.map((line, i) => (
          <div key={i}>
            <dt>{line.kind === 'price' ? line.label : `${line.label}, ${KIND[line.kind]}`}</dt>
            <dd>{money(line.amount)}</dd>
          </div>
        ))}
        <div className="total">
          <dt>You keep</dt>
          <dd>{money(outcome.net)}</dd>
        </div>
        <div>
          <dt>{outcome.qty === 1 ? 'It costs you' : `It costs you, for ${outcome.qty}`}</dt>
          <dd>{money(outcome.cost)}</dd>
        </div>
        <div className={margin < 0 ? 'loss' : 'total'}>
          <dt>{margin < 0 ? 'You lose' : 'You earn'}</dt>
          <dd>{money(Math.abs(margin))}</dd>
        </div>
      </dl>
    </>
  );
}

function CostForm({ id, cost, open }: { id: string; cost: number | null; open: boolean }) {
  const { change } = useApp();
  const [value, setValue] = useState(cost === null ? '' : editable(cost));
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseMoney(value);
    if (parsed === null) {
      setError('Enter what one item costs you, like 24.50');
      input.current?.focus();
      return;
    }
    setError('');
    void change(() => call('setCost', id, parsed), 'Cost saved and audit updated');
  };

  const form = (
    <form className="section" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="cost">Cost per item</label>
        <input id="cost" name="cost" ref={input} inputMode="decimal" autoComplete="off" placeholder="24.50" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error || undefined} aria-describedby={error ? 'cost-error' : undefined} />
        {error && <p className="error" id="cost-error">{error}</p>}
      </div>
      <div className="actions">
        <button className={open ? 'btn primary' : 'btn'} type="submit">Save cost</button>
      </div>
    </form>
  );
  return open ? <div className="card">{form}</div> : <Disclosure summary="Change the cost">{form}</Disclosure>;
}

export function Product({ id }: { id: string }) {
  const { data, change, money } = useApp();
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const refocus = useRef(false);

  useEffect(() => {
    let current = true;
    call('product', id, previewing && chosen ? chosen : undefined).then(
      (next) => {
        if (!current) return;
        setIssues([]);
        setDetail(next);
      },
      (error) => {
        if (!current) return;
        if (previewing) {
          setPreviewing(false);
          setChosen(null);
        } else setIssues(explainError(error));
      },
    );
    return () => {
      current = false;
    };
  }, [id, data, previewing, chosen]);

  const row = data.audit.variants.find((v) => v.id === id);

  useEffect(() => {
    if (detail && refocus.current) {
      refocus.current = false;
      document.getElementById('preview-toggle')?.focus();
    }
  }, [detail]);

  if (!row) {
    return (
      <Page title="Product not found" lead="It may have been replaced by an import." back={{ href: '#audit', label: 'Audit' }}>
        <div className="actions"><a className="btn primary" href="#products">See all products</a></div>
      </Page>
    );
  }

  const { state, worst } = row;
  const loss = worst ? worst.cost - worst.net : 0;
  const stacked = worst?.stack.length ?? 0;

  const title = state === 'leak' ? `${row.title} loses ${money(loss)}` : row.title;
  let lead: string;
  if (state === 'leak') {
    lead = stacked
      ? plural(stacked, {
          one: `{n} discount is enough to bring it below the ${money(worst!.cost / worst!.qty)} it costs you.`,
          other: `{n} discounts can be used together, and then it sells below the ${money(worst!.cost / worst!.qty)} it costs you.`,
        })
      : 'Its price is lower than its cost, even with no discount.';
  } else if (state === 'unknown') lead = row.unknown.map((u) => UNKNOWN_TEXT[u]).join(' ');
  else if (state === 'thin') lead = 'It stays above cost, but below the margin you set.';
  else lead = 'No discount stack in the modeled rules sells it below cost.';

  const fixes = detail?.fixes ?? [];
  const fix: Fix | undefined = fixes.find((f) => f.id === chosen) ?? fixes[0];
  const preview = previewing && detail?.preview?.fix.id === fix?.id ? detail?.preview : null;
  const shown = preview ? preview.worst : detail?.worst;
  const listed = fix && data.app.checklist.some((item) => !item.done && item.id === changeId(fix.changes));

  const togglePreview = () => {
    refocus.current = true;
    if (!preview && fix) setChosen(fix.id);
    setPreviewing(!preview);
  };

  return (
    <Page title={title} lead={lead} back={{ href: '#audit', label: 'Audit' }}>
      <Issues issues={issues} />

      {shown && (
        <section className={`card${preview ? ' tinted' : ''}`} aria-labelledby="receipt-title" aria-live="polite">
          <div className="card-head">
            <h2 id="receipt-title">{preview ? 'After the fix, at worst' : state === 'leak' ? 'How the money goes' : 'The worst case'}</h2>
            {preview ? <span className="badge">Preview, nothing changed</span> : <StateBadge state={state} />}
          </div>
          <Receipt explained={shown} />
        </section>
      )}

      {state === 'leak' && fix && (
        <section className="card" aria-labelledby="fix-title">
          <h2 id="fix-title">How to fix it</h2>
          <ol className={fix.changes.length > 1 ? 'steps' : 'section'}>
            {fix.changes.map((c, i) => {
              const { title: what, setting } = describeChange(c);
              return (
                <li key={i}>
                  <h3>{what}</h3>
                  <p className="caption muted">{setting}</p>
                </li>
              );
            })}
          </ol>
          <p className="muted">
            {fix.breaks.length
              ? `${plural(fix.breaks.length, {
                  one: 'Side effect: {n} profitable combination stops working',
                  other: 'Side effect: {n} profitable combinations stop working',
                })}${fix.breaks.length === 1 ? ` (${fix.breaks[0].join(' + ')})` : ''}.`
              : 'No profitable combination is affected.'}
          </p>
          <div className="actions">
            <button id="preview-toggle" className={`btn with-icon${preview ? '' : ' primary'}`} onClick={togglePreview}>
              <Icon icon={preview ? Undo02Icon : ViewIcon} strong />
              {preview ? 'End preview' : 'Preview fix'}
            </button>
            {listed ? (
              <a className={`btn${preview ? ' primary' : ''}`} href="#checklist">View checklist</a>
            ) : (
              <button
                className={`btn with-icon${preview ? ' primary' : ''}`}
                onClick={() => change(() => call('addToChecklist', fix.changes, row.title), 'Fix added to your checklist')}
              >
                <Icon icon={Add01Icon} strong />
                Add to checklist
              </button>
            )}
          </div>
        </section>
      )}

      {state === 'unknown' && row.unknown.includes('missing_cost') && <CostForm id={id} cost={null} open />}
      {state === 'unknown' && !row.unknown.includes('missing_cost') && (
        <div className="actions"><a className="btn primary" href="#discounts">Review discounts</a></div>
      )}

      <div className="section">
        {state === 'leak' && fixes.length > 1 && (
          <Disclosure summary={plural(fixes.length - 1, { one: 'Show {n} other fix', other: 'Show {n} other fixes' })}>
            <ul className="rows">
              {fixes.filter((f) => f.id !== fix?.id).slice(0, 5).map((f) => (
                <li key={f.id}>
                  <button
                    className="row"
                    onClick={() => {
                      refocus.current = true;
                      setChosen(f.id);
                      setPreviewing(true);
                    }}
                  >
                    <span className="body">
                      <strong>{f.changes.map((c) => describeChange(c).title).join(', then ')}</strong>
                      <span className="caption muted">
                        {f.breaks.length
                          ? plural(f.breaks.length, { one: 'Also stops {n} profitable combination', other: 'Also stops {n} profitable combinations' })
                          : 'No side effects'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        {!!detail?.worst?.pairs.length && (
          <Disclosure summary="Why can these be used together?">
            <ul className="facts">
              {detail.worst.pairs.map((pair) => (
                <li key={pair.key}>
                  <span className="stack">
                    <span className="chip">{pair.left}</span>
                    <Icon icon={Link01Icon} size={15} />
                    <span className="chip">{pair.right}</span>
                  </span>
                  <span className="caption muted">{pair.rule}</span>
                </li>
              ))}
            </ul>
            <p className="caption muted">A stack works only when every pair in it combines.</p>
            <details>
              <summary className="caption">Show the Relate query</summary>
              <pre>{detail.query}</pre>
            </details>
          </Disclosure>
        )}
        {row.cost !== null && <CostForm id={id} cost={row.cost} open={false} key={row.cost} />}
      </div>
    </Page>
  );
}
