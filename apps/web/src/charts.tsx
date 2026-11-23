// Small, dependency-free charts in the dataviz conventions: thin marks with 4px rounded data ends,
// one baseline, a 2px surface gap, values as text beside the marks, and status hues only with a label.
// Every value is also readable without hover: as a label, a legend entry or a hidden table.
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { plural } from './ui.tsx';

export type Tone = 'leak' | 'thin' | 'clear' | 'unknown' | 'accent';

/** One headline number with a short label, linking to where it comes from. */
export function StatTile({ label, value, note, tone, href }: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone; href?: string }) {
  const body = (
    <>
      <span className="stat-label">
        {tone && <span className={`swatch ${tone}`} aria-hidden="true" />}
        {label}
      </span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </>
  );
  return href ? <a className="stat" href={href}>{body}</a> : <div className="stat">{body}</div>;
}

/** A card holding one chart: a title that says what is plotted, and an optional link to the detail. */
export function ChartCard({ title, subtitle, action, children, wide }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; wide?: boolean }) {
  const id = useId();
  return (
    <section className={`chart-card${wide ? ' wide' : ''}`} aria-labelledby={id}>
      <div className="chart-head">
        <div>
          <h2 id={id}>{title}</h2>
          {subtitle && <p className="caption muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Ranked horizontal bars, largest first, one hue. The value sits at the bar's tip as text. */
export function RankedBars({ rows, tone, empty }: { rows: { id: string; label: string; value: number; display: string; href?: string; detail?: string }[]; tone: Tone; empty: string }) {
  if (!rows.length) return <p className="muted chart-empty">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ol className="ranked">
      {rows.map((r) => {
        const inner = (
          <>
            <span className="ranked-label">
              <span className="ranked-name">{r.label}</span>
              {r.detail && <span className="caption muted code">{r.detail}</span>}
            </span>
            <span className="ranked-bar">
              <span className={`ranked-fill ${tone}`} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
              <span className="ranked-value num">{r.display}</span>
            </span>
          </>
        );
        return <li key={r.id}>{r.href ? <a className="ranked-row" href={r.href}>{inner}</a> : <span className="ranked-row">{inner}</span>}</li>;
      })}
    </ol>
  );
}

/** One whole split into parts: a tall segmented bar with shares printed where they fit, and a legend of names and counts. */
export function SegmentedBar({ parts, unit }: { parts: { label: string; value: number; tone: Tone; href?: string }[]; unit: { one: string; other: string } }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  const summary = shown.map((p) => `${p.label}: ${plural(p.value, unit)}`).join(', ');
  return (
    <div className="segmented">
      <div className="segmented-bar" role="img" aria-label={summary}>
        {shown.map((p) => {
          const share = p.value / total;
          return (
            <span key={p.label} className={`segment ${p.tone}`} style={{ flexGrow: p.value }} title={`${p.label}: ${plural(p.value, unit)}`}>
              {share >= 0.12 ? `${Math.round(share * 100)}%` : ''}
            </span>
          );
        })}
      </div>
      <ul className="legend">
        {parts.map((p) => {
          const inner = (
            <>
              <span className={`swatch ${p.tone}`} aria-hidden="true" />
              <span>{p.label}</span>
              <span className="num legend-value">{p.value}</span>
            </>
          );
          return <li key={p.label}>{p.href && p.value > 0 ? <a href={p.href}>{inner}</a> : <span>{inner}</span>}</li>;
        })}
      </ul>
    </div>
  );
}

export interface ColumnPoint {
  key: string;
  /** Shown under the column where there is room, and in the tooltip. */
  label: string;
  /** Short axis label, or empty to leave this column unlabeled. */
  tick: string;
  value: number;
  detail?: string;
}

/** Columns over time, one hue, with a hover and keyboard tooltip and a hidden table for screen readers. */
export function ColumnChart({ points, tone, unit, summary }: { points: ColumnPoint[]; tone: Tone; unit: { one: string; other: string }; summary: string }) {
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();
  const max = Math.max(1, ...points.map((p) => p.value));
  const W = 720;
  const H = 120;
  const top = 12;
  const bottom = 24;
  const plot = H - top - bottom;
  const band = W / points.length;
  const bar = Math.max(2, Math.min(16, band * 0.6));
  const y = (v: number) => top + plot - (v / max) * plot;
  const path = (x: number, h: number) => {
    // 4px rounded data end, square at the baseline.
    const r = Math.min(4, h, bar / 2);
    const base = top + plot;
    return `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + bar - r} Q${x + bar},${base - h} ${x + bar},${base - h + r} V${base} Z`;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    setActive((i) => Math.max(0, Math.min(points.length - 1, (i ?? -1) + (e.key === 'ArrowRight' ? 1 : -1))));
  };
  const current = active === null ? null : points[active];

  return (
    <div className="columns">
      <div className="columns-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${summary} Use the left and right arrow keys to read each day.`}
          aria-describedby={tableId}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
        >
          <line x1="0" x2={W} y1={top + plot + 0.5} y2={top + plot + 0.5} className="axis" />
          <line x1="0" x2={W} y1={y(max) + 0.5} y2={y(max) + 0.5} className="grid" />
          {points.map((p, i) => {
            const x = i * band + (band - bar) / 2;
            const h = (p.value / max) * plot;
            return (
              <g key={p.key} onPointerEnter={() => setActive(i)}>
                <rect x={i * band} y={top} width={band} height={plot} fill="transparent" />
                {h > 0 && <path d={path(x, h)} className={`col ${tone}${active === i ? ' on' : ''}`} />}
              </g>
            );
          })}
        </svg>
        <span className="columns-max num" aria-hidden="true">{max}</span>
        {current && (
          <div className="tooltip" role="status" style={{ insetInlineStart: `${((points.indexOf(current) + 0.5) / points.length) * 100}%` }}>
            <strong className="num">{plural(current.value, unit)}</strong>
            <span>{current.label}</span>
            {current.detail && <span className="caption">{current.detail}</span>}
          </div>
        )}
      </div>
      <div className="columns-ticks" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
        {points.map((p) => <span key={p.key}>{p.tick}</span>)}
      </div>
      <div className="sr">
      <table id={tableId}>
        <caption>{summary}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}><th scope="row">{p.label}</th><td>{plural(p.value, unit)}</td></tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/** One column per day from the calendar's stretches: the most products below cost at any point that day. */
export function calendarDays(
  cal: { start: number; segments: { start: number; end: number; leaks: { title: string }[] }[] },
  days: number,
  formatDay: (ms: number) => string,
): ColumnPoint[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(cal.start);
    d.setDate(d.getDate() + i);
    const from = d.getTime();
    const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const here = cal.segments.filter((s) => s.start < to && s.end > from);
    const value = Math.max(0, ...here.map((s) => s.leaks.length));
    const names = [...new Set(here.flatMap((s) => s.leaks.map((l) => l.title)))];
    return {
      key: String(from),
      label: formatDay(from),
      tick: i === 0 ? 'Today' : d.getDay() === 1 ? `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}` : '',
      value,
      detail: value ? names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '') : undefined,
    };
  });
}
