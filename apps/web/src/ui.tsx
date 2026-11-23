import Alert02Icon from '@hugeicons/core-free-icons/Alert02Icon';
import ArrowDown01Icon from '@hugeicons/core-free-icons/ArrowDown01Icon';
import ArrowLeft01Icon from '@hugeicons/core-free-icons/ArrowLeft01Icon';
import CheckmarkCircle02Icon from '@hugeicons/core-free-icons/CheckmarkCircle02Icon';
import DropletIcon from '@hugeicons/core-free-icons/DropletIcon';
import HelpCircleIcon from '@hugeicons/core-free-icons/HelpCircleIcon';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { State } from '../../../packages/core/src/types.ts';

/** Every icon goes through here: one library, stroke matched to the weight of the text beside it. */
export function Icon({ icon, size = 18, strong = false }: { icon: IconSvgElement; size?: number; strong?: boolean }) {
  return (
    <HugeiconsIcon icon={icon} size={size} strokeWidth={strong ? 2 : 1.5} absoluteStrokeWidth color="currentColor" aria-hidden="true" focusable="false" />
  );
}

export const STATE = {
  leak: { label: 'Leak', icon: DropletIcon },
  unknown: { label: 'Can’t be sure', icon: HelpCircleIcon },
  thin: { label: 'Thin margin', icon: Alert02Icon },
  clear_in_model: { label: 'No leak found', icon: CheckmarkCircle02Icon },
} as const satisfies Record<State, { label: string; icon: IconSvgElement }>;

export function StateBadge({ state }: { state: State }) {
  return (
    <span className={`badge ${state}`}>
      <Icon icon={STATE[state].icon} size={15} strong />
      {STATE[state].label}
    </span>
  );
}

export function Page({ title, lead, action, back, wide, children }: {
  title: string;
  wide?: boolean;
  lead?: ReactNode;
  action?: ReactNode;
  back?: { href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <div className={wide ? 'page wide' : 'page'}>
      {back && (
        <a className="back" href={back.href}>
          <Icon icon={ArrowLeft01Icon} />
          {back.label}
        </a>
      )}
      <div className="page-head">
        <div>
          <h1 tabIndex={-1}>{title}</h1>
          {lead && <p>{lead}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function Disclosure({ summary, children, open }: { summary: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="disclosure" open={open}>
      <summary>
        {summary}
        <Icon icon={ArrowDown01Icon} strong />
      </summary>
      <div className="inside">{children}</div>
    </details>
  );
}

/** Errors not tied to one field. They take focus, so they are seen and announced. */
export function Issues({ issues }: { issues: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (issues.length) box.current?.focus();
  }, [issues]);
  if (!issues.length) return null;
  return (
    <div className="card leak" role="alert" tabIndex={-1} ref={box}>
      <h2>Fix this, then try again</h2>
      <ul className="facts">
        {issues.slice(0, 12).map((issue, i) => (
          <li className="error" key={i}>
            <Icon icon={Alert02Icon} size={15} />
            {issue}
          </li>
        ))}
      </ul>
      {issues.length > 12 && <p className="caption">Showing 12 of {issues.length}. Fix these first.</p>}
    </div>
  );
}

export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const plurals = new Intl.PluralRules('en');
/** One whole sentence per plural form, with {n} as the number. */
export function plural(n: number, forms: { one: string; other: string }): string {
  return (plurals.select(n) === 'one' ? forms.one : forms.other).replace('{n}', n.toLocaleString('en'));
}

const TILES = ['tile-a', 'tile-b', 'tile-c', 'tile-d'];

/** The product image when the import has one, otherwise a tile with its initials. */
export function Thumb({ title, image }: { title: string; image?: string }) {
  const [broken, setBroken] = useState(false);
  if (image && !broken) {
    return <img className="thumb" src={image} alt="" width={40} height={40} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  const words = title.trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  const initials = (words.length ? words.slice(0, 2).map((w) => [...w][0]).join('') : [...title.trim()][0] ?? '?').toUpperCase();
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return <span className={`thumb ${TILES[hash % TILES.length]}`} aria-hidden="true">{initials}</span>;
}

/** A row of filter buttons with counts, like the status tabs above a Shopify admin table. */
export function Filters<K extends string>({ label, options, value, onChange }: {
  label: string;
  options: { key: K; label: string; count: number }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div className="filters" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} className="filter" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}
          <span className="filter-count num">{o.count}</span>
        </button>
      ))}
    </div>
  );
}
