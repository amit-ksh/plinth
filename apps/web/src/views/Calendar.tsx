import Add01Icon from '@hugeicons/core-free-icons/Add01Icon';
import CheckmarkCircle02Icon from '@hugeicons/core-free-icons/CheckmarkCircle02Icon';
import DropletIcon from '@hugeicons/core-free-icons/DropletIcon';
import { useEffect, useState } from 'react';
import type { Calendar as CalendarData } from '../../../../packages/core/src/workspace.ts';
import { formatDay, formatStretch, productHref, useApp } from '../context.ts';
import { call, explainError } from '../engine.ts';
import { Disclosure, Icon, Issues, Page, plural } from '../ui.tsx';

const DAYS = 42;
const DAY = 86_400_000;

/** Day index (0 = today) for a time, clamped to the window. Days are local, so DST shifts are absorbed by rounding. */
const dayOf = (cal: CalendarData, t: number) => Math.min(DAYS, Math.max(0, Math.round((t - cal.start) / DAY)));

function Timeline({ cal }: { cal: CalendarData }) {
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(cal.start);
    d.setDate(d.getDate() + i);
    return d;
  });
  const leakOn = days.map((d) => {
    const from = d.getTime();
    const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    return Math.max(0, ...cal.segments.filter((s) => s.start < to && s.end > from).map((s) => s.leaks.length));
  });
  const shown = cal.discounts.filter((d) => (d.ends === null || d.ends > cal.start) && (d.starts === null || d.starts < cal.end));

  return (
    // A picture of the list below it, which carries the same facts for assistive technology.
    <div className="timeline-scroll" aria-hidden="true">
      <div className="timeline" style={{ gridTemplateColumns: `minmax(96px, max-content) repeat(${DAYS}, minmax(22px, 1fr))` }}>
        <span className="tl-corner" />
        {days.map((d, i) => (
          <span key={`h${i}`} className={`tl-day${d.getDay() === 1 || i === 0 ? ' week' : ''}`}>
            {i === 0 ? 'Today' : d.getDay() === 1 ? `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}` : ''}
          </span>
        ))}
        <span className="tl-label">Leaks</span>
        {leakOn.map((n, i) => (
          <span key={`r${i}`} className={`tl-risk${n ? ' leak' : ''}`} title={n ? `${n} below cost` : 'No leak found'}>{n || ''}</span>
        ))}
        {shown.map((d) => {
          const from = d.starts === null ? 0 : dayOf(cal, d.starts);
          const to = d.ends === null ? DAYS : Math.max(from + 1, dayOf(cal, d.ends));
          return [
            <span key={`l${d.id}`} className="tl-label code">{d.id}</span>,
            <span key={`b${d.id}`} className={`tl-bar ${d.class}${d.supported ? '' : ' unsure'}`} style={{ gridColumn: `${from + 2} / ${to + 2}` }}>
              {d.title}
            </span>,
          ];
        })}
      </div>
    </div>
  );
}

export function Calendar() {
  const { data, money } = useApp();
  const [cal, setCal] = useState<CalendarData | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    call('calendar', DAYS).then(
      (c) => live && setCal(c),
      (e) => live && setIssues(explainError(e)),
    );
    return () => {
      live = false;
    };
  }, [data]);

  const leakDays = cal
    ? cal.segments.filter((s) => s.leaks.length).reduce((n, s) => n + Math.round((s.end - s.start) / DAY), 0)
    : 0;

  return (
    <Page
      title="Calendar"
      wide
      lead="The next six weeks: what’s live each day, and what sells below cost while it is."
      action={
        <a className="btn primary with-icon" href="#discounts/:new">
          <Icon icon={Add01Icon} strong />
          Plan a promotion
        </a>
      }
    >
      <Issues issues={issues} />
      {!cal ? (
        <p className="muted" role="status">Checking each day…</p>
      ) : (
        <>
          <p className={`calendar-summary${leakDays ? ' leak' : ''}`} role="status">
            <Icon icon={leakDays ? DropletIcon : CheckmarkCircle02Icon} />
            {leakDays
              ? `Products sell below cost on ${plural(leakDays, { one: '{n} day', other: '{n} days' })} of the next ${DAYS}.`
              : `No leak found on any day of the next ${DAYS}.`}
          </p>
          {cal.discounts.length > 0 && <Timeline cal={cal} />}
          <div className="section">
            <h2>Day by day</h2>
            <ul className="stretches">
              {cal.segments.map((s) => (
                <li key={s.start} className={`stretch${s.leaks.length ? ' leak' : ''}`}>
                  <div className="stretch-head">
                    <strong>{formatStretch(s.start, s.end)}</strong>
                    <span className={s.leaks.length ? 'danger-text' : 'muted'}>
                      {s.leaks.length ? plural(s.leaks.length, { one: '{n} product below cost', other: '{n} products below cost' }) : 'No leak found'}
                    </span>
                  </div>
                  <p className="caption muted">
                    {s.active.length ? <>Live: <span className="code">{s.active.join(', ')}</span></> : 'No discounts live'}
                  </p>
                  {s.leaks.length > 0 && (
                    <Disclosure summary={plural(s.leaks.length, { one: 'See the product', other: 'See the {n} products' })}>
                      <ul className="rows">
                        {s.leaks.slice(0, 10).map((l) => (
                          <li key={l.id}>
                            <a className="row" href={productHref(l.id)}>
                              <span className="body">
                                <strong>{l.title}</strong>
                                <span className="caption code">{l.stack.join(' + ')}</span>
                              </span>
                              <span className="end danger-text num">Loses {money(l.loss)}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </Disclosure>
                  )}
                </li>
              ))}
            </ul>
            {cal.truncated && <p className="caption">Discounts change too often to check every day after {formatDay(cal.segments.at(-1)!.end)}.</p>}
          </div>
        </>
      )}
    </Page>
  );
}
