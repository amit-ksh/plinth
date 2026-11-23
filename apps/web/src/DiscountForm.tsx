import { useId, useState, type FormEvent } from 'react';
import { parseMoney, parsePercent } from '../../../packages/core/src/format.ts';
import type { Discount, DiscountClass, StoreInput } from '../../../packages/core/src/types.ts';
import { editable, endField, fromEndField, fromStartField, startField, useApp } from './context.ts';
import { Disclosure, plural } from './ui.tsx';

export function amountOf(d: Discount, money: (minor: number) => string): string {
  if (!d.supported) return 'Not modeled';
  if (d.class === 'shipping') return 'Free shipping';
  const parts = [];
  if (d.bps) parts.push(`${d.bps / 100}%`);
  if (d.off) parts.push(money(d.off));
  return parts.length ? `${parts.join(' and ')} off` : 'Nothing off';
}

export function targetOf(d: Discount, store: StoreInput): string {
  if (d.allVariants) return 'all products';
  const count = d.collections.length + d.variants.length;
  if (count === 1) {
    const [collection] = d.collections;
    return collection
      ? (store.collections.find((c) => c.id === collection)?.title ?? collection)
      : (store.variants.find((v) => v.id === d.variants[0])?.title ?? d.variants[0]);
  }
  return d.collections.length
    ? plural(count, { one: '{n} selection', other: '{n} selections' })
    : plural(count, { one: '{n} product', other: '{n} products' });
}

export function summarize(d: Discount, store: StoreInput, money: (minor: number) => string): string {
  const minimum = d.minSubtotal ? ` over ${money(d.minSubtotal)}` : '';
  return `${amountOf(d, money)}${minimum}, on ${targetOf(d, store)}`;
}

const CLASSES: [DiscountClass, string][] = [
  ['product', 'Product discounts'],
  ['order', 'Order discounts'],
  ['shipping', 'Shipping discounts'],
];

const splitTags = (text: string) => [...new Set(text.split(',').map((t) => t.trim()).filter(Boolean))];

type Kind = 'percent' | 'amount' | 'shipping' | 'unsupported';

export function DiscountForm({ initial, submitLabel, onSubmit }: {
  initial: Discount;
  submitLabel: string;
  onSubmit: (discount: Discount) => void;
}) {
  const { data } = useApp();
  const uid = useId();
  const [kind, setKind] = useState<Kind>(
    !initial.supported ? 'unsupported' : initial.class === 'shipping' ? 'shipping' : !initial.bps && initial.off ? 'amount' : 'percent',
  );
  const [code, setCode] = useState(initial.id);
  const [value, setValue] = useState(
    kind === 'amount' ? editable(initial.off) : kind === 'percent' && initial.bps ? String(initial.bps / 100) : '',
  );
  const [level, setLevel] = useState<'product' | 'order'>(initial.class === 'order' ? 'order' : 'product');
  const single = initial.collections.length + initial.variants.length === 1;
  const [target, setTarget] = useState(
    initial.allVariants ? 'all' : !single ? 'keep' : initial.collections.length ? `c:${initial.collections[0]}` : `v:${initial.variants[0]}`,
  );
  const [minimum, setMinimum] = useState(initial.minSubtotal ? editable(initial.minSubtotal) : '');
  const [method, setMethod] = useState(initial.method);
  const [combines, setCombines] = useState(initial.combinesWith);
  const [tags, setTags] = useState(initial.tags.join(', '));
  const [accepts, setAccepts] = useState(initial.acceptsTags.join(', '));
  const [starts, setStarts] = useState(startField(initial.starts));
  const [ends, setEnds] = useState(endField(initial.ends));
  const [errors, setErrors] = useState<{ code?: string; value?: string; minimum?: string; starts?: string; ends?: string }>({});

  const id = (name: string) => `${uid}-${name}`;
  const described = (name: keyof typeof errors, hint?: string) =>
    errors[name] ? id(`${name}-error`) : hint ? id(hint) : undefined;
  const cls: DiscountClass = kind === 'shipping' ? 'shipping' : kind === 'unsupported' ? initial.class : level;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: typeof errors = {};
    const amount = kind === 'percent' ? parsePercent(value) : kind === 'amount' ? parseMoney(value) : 0;
    const least = minimum.trim() ? parseMoney(minimum) : 0;
    if (!/^[A-Za-z0-9_./:-]{1,128}$/.test(code.trim())) found.code = 'Use letters, numbers, - or _, with no spaces';
    if (amount === null) found.value = kind === 'percent' ? 'Enter a percentage from 0 to 100, like 20' : 'Enter an amount like 10.00';
    if (least === null) found.minimum = 'Enter an amount like 50.00, or leave it empty';
    const startAt = fromStartField(starts);
    const endAt = fromEndField(ends);
    if (startAt === undefined) found.starts = 'Choose a date, or leave it empty to start now';
    if (endAt === undefined) found.ends = 'Choose a date, or leave it empty to run with no end';
    else if (endAt !== null && startAt && endAt <= startAt) found.ends = 'Choose an end on or after the start';
    setErrors(found);

    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(id(first))?.focus();
      return;
    }

    const scope =
      target === 'keep'
        ? { allVariants: initial.allVariants, variants: initial.variants, collections: initial.collections }
        : {
            allVariants: target === 'all',
            collections: target.startsWith('c:') ? [target.slice(2)] : [],
            variants: target.startsWith('v:') ? [target.slice(2)] : [],
          };
    const money =
      kind === 'unsupported'
        ? { bps: initial.bps, off: initial.off }
        : { bps: kind === 'percent' ? amount! : 0, off: kind === 'amount' ? amount! : 0 };

    onSubmit({
      ...initial,
      ...scope,
      ...money,
      id: code.trim(),
      class: cls,
      supported: kind !== 'unsupported',
      method,
      minSubtotal: least!,
      combinesWith: combines,
      tags: splitTags(tags),
      acceptsTags: splitTags(accepts),
      starts: startAt ?? null,
      // An unchanged end keeps its exact time, so a Shopify end at 3pm isn't moved to midnight.
      ends: ends === endField(initial.ends) ? initial.ends : endAt ?? null,
    });
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="fields">
        <div className="field">
          <label htmlFor={id('code')}>Code</label>
          <input id={id('code')} name="code" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={!!errors.code || undefined} aria-describedby={described('code')} />
          {errors.code && <p className="error" id={id('code-error')}>{errors.code}</p>}
        </div>
        <div className="field">
          <label htmlFor={id('kind')}>Type</label>
          <select id={id('kind')} name="kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="percent">Percentage off</option>
            <option value="amount">Amount off</option>
            <option value="shipping">Free shipping</option>
            {!initial.supported && <option value="unsupported">Not modeled</option>}
          </select>
        </div>
        {(kind === 'percent' || kind === 'amount') && (
          <>
            <div className="field">
              <label htmlFor={id('value')}>{kind === 'percent' ? 'Percentage' : 'Amount'}</label>
              <input id={id('value')} name="value" inputMode="decimal" autoComplete="off" placeholder={kind === 'percent' ? '20' : '10.00'} value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!errors.value || undefined} aria-describedby={described('value')} />
              {errors.value && <p className="error" id={id('value-error')}>{errors.value}</p>}
            </div>
            <div className="field">
              <label htmlFor={id('level')}>Comes off</label>
              <select id={id('level')} name="level" value={level} onChange={(e) => setLevel(e.target.value as 'product' | 'order')}>
                <option value="product">Each product</option>
                <option value="order">The whole order</option>
              </select>
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor={id('target')}>Applies to</label>
          <select id={id('target')} name="target" value={target} onChange={(e) => setTarget(e.target.value)}>
            {!initial.allVariants && !single && <option value="keep">{targetOf(initial, data.store)}</option>}
            <option value="all">All products</option>
            {data.store.collections.length > 0 && (
              <optgroup label="Collections">
                {data.store.collections.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.title}</option>)}
              </optgroup>
            )}
            <optgroup label="Products">
              {data.store.variants.map((v) => <option key={v.id} value={`v:${v.id}`}>{v.title}</option>)}
            </optgroup>
          </select>
        </div>
        <div className="field">
          <label htmlFor={id('minimum')}>Minimum spend (optional)</label>
          <input id={id('minimum')} name="minimum" inputMode="decimal" autoComplete="off" placeholder="50.00" value={minimum} onChange={(e) => setMinimum(e.target.value)} aria-invalid={!!errors.minimum || undefined} aria-describedby={described('minimum')} />
          {errors.minimum && <p className="error" id={id('minimum-error')}>{errors.minimum}</p>}
        </div>
        <div className="field">
          <label htmlFor={id('starts')}>Starts (optional)</label>
          <input id={id('starts')} name="starts" type="date" value={starts} onChange={(e) => setStarts(e.target.value)} aria-invalid={!!errors.starts || undefined} aria-describedby={described('starts', 'starts-hint')} />
          {errors.starts ? <p className="error" id={id('starts-error')}>{errors.starts}</p> : <p className="hint" id={id('starts-hint')}>Empty starts it now.</p>}
        </div>
        <div className="field">
          <label htmlFor={id('ends')}>Last day (optional)</label>
          <input id={id('ends')} name="ends" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} aria-invalid={!!errors.ends || undefined} aria-describedby={described('ends', 'ends-hint')} />
          {errors.ends ? <p className="error" id={id('ends-error')}>{errors.ends}</p> : <p className="hint" id={id('ends-hint')}>It runs through the end of this day.</p>}
        </div>
      </div>

      <fieldset className="field">
        <legend>Can combine with</legend>
        <div className="checks">
          {CLASSES.map(([name, label]) => (
            <label className="check" key={name}>
              <input
                type="checkbox"
                name="combines"
                checked={combines.includes(name)}
                onChange={(e) => setCombines(e.target.checked ? [...combines, name] : combines.filter((c) => c !== name))}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <Disclosure summary="More options">
        <div className="fields">
          <div className="field">
            <label htmlFor={id('method')}>How customers get it</label>
            <select id={id('method')} name="method" value={method} onChange={(e) => setMethod(e.target.value as Discount['method'])}>
              <option value="code">They enter a code</option>
              <option value="automatic">It applies automatically</option>
            </select>
          </div>
          {cls === 'product' && (
            <>
              <div className="field">
                <label htmlFor={id('tags')}>Its tags</label>
                <input id={id('tags')} name="tags" autoComplete="off" spellCheck={false} placeholder="vip, winter" value={tags} onChange={(e) => setTags(e.target.value)} aria-describedby={id('tags-hint')} />
                <p className="hint" id={id('tags-hint')}>Two product discounts stack only if each accepts a tag on the other.</p>
              </div>
              <div className="field">
                <label htmlFor={id('accepts')}>Tags it accepts</label>
                <input id={id('accepts')} name="accepts" autoComplete="off" spellCheck={false} placeholder="vip, winter" value={accepts} onChange={(e) => setAccepts(e.target.value)} />
              </div>
            </>
          )}
        </div>
      </Disclosure>

      <div className="actions">
        <button className="btn primary" type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}
