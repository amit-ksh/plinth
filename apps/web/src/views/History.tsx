import ArrowTurnBackwardIcon from '@hugeicons/core-free-icons/ArrowTurnBackwardIcon';
import type { HistoryEntry } from '../../../../packages/core/src/app-state.ts';
import type { Discount, StoreInput } from '../../../../packages/core/src/types.ts';
import { endField, useApp } from '../context.ts';
import { amountOf, targetOf } from '../DiscountForm.tsx';
import { Icon, Page } from '../ui.tsx';
import { useWriter } from '../writer.ts';

const WHEN = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const VERB: Record<HistoryEntry['action'], string> = {
  create: 'Created', update: 'Changed', end: 'Ended', reactivate: 'Running again', delete: 'Deleted', fix: 'Fixed from the checklist', rollback: 'Rolled back',
};
const CLASSES = { product: 'product', order: 'order', shipping: 'shipping' } as const;

/** What changed between two versions, in a few words each. */
function differences(a: Discount, b: Discount, store: StoreInput, money: (n: number) => string): string[] {
  const out: string[] = [];
  const list = (xs: string[]) => (xs.length ? xs.map((x) => CLASSES[x as keyof typeof CLASSES] ?? x).join(', ') : 'nothing');
  if (a.id !== b.id) out.push(`code ${a.id} → ${b.id}`);
  if (amountOf(a, money) !== amountOf(b, money)) out.push(`${amountOf(a, money)} → ${amountOf(b, money)}`);
  if (targetOf(a, store) !== targetOf(b, store)) out.push(`on ${targetOf(a, store)} → ${targetOf(b, store)}`);
  if (a.minSubtotal !== b.minSubtotal) out.push(`minimum ${a.minSubtotal ? money(a.minSubtotal) : 'none'} → ${b.minSubtotal ? money(b.minSubtotal) : 'none'}`);
  if (list(a.combinesWith) !== list(b.combinesWith)) out.push(`combines with ${list(a.combinesWith)} → ${list(b.combinesWith)}`);
  if (a.tags.join() !== b.tags.join() || a.acceptsTags.join() !== b.acceptsTags.join()) out.push('tags changed');
  if (a.method !== b.method) out.push(b.method === 'code' ? 'now needs a code' : 'now automatic');
  if (a.starts !== b.starts) out.push('start date changed');
  if (a.ends !== b.ends) out.push(b.ends === null ? 'no end date' : `last day ${endField(b.ends)}`);
  return out;
}

export function History() {
  const { data, money } = useApp();
  const writer = useWriter();
  const { history } = data.app;
  // Only the latest change to each discount can be rolled back; older ones wait for it.
  const latest = new Map<string, string>();
  for (const e of history) {
    if (e.rolledBack) continue;
    for (const key of new Set([e.discount, e.before?.id, e.after?.id].filter(Boolean) as string[])) latest.set(key, e.id);
  }

  return (
    <Page title="History" wide lead="Every change to a discount, newest first. Roll back the latest change to any of them.">
      {history.length === 0 ? (
        <div className="card">
          <h2>No changes yet</h2>
          <p>Changes you make to discounts here, and fixes you mark as made, are listed with what they were before.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Discount</th>
                <th scope="col" className="hide-narrow">What changed</th>
                <th scope="col" className="hide-narrow">Saved to</th>
                <th scope="col"><span className="sr">Roll back</span></th>
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((e) => {
                const changes = e.before && e.after ? differences(e.before, e.after, data.store, money) : [];
                const detail = e.action === 'create' && e.after ? `${amountOf(e.after, money)}, on ${targetOf(e.after, data.store)}` : changes.join('; ');
                const canRoll = !e.rolledBack && [e.discount, e.before?.id, e.after?.id].filter(Boolean).every((k) => latest.get(k!) === e.id);
                return (
                  <tr key={e.id}>
                    <td className="nowrap">{WHEN.format(new Date(e.at))}</td>
                    <td>
                      <span className="cell-main">
                        <strong className="code">{e.discount}</strong>
                        <span className="caption muted">{VERB[e.action]}</span>
                      </span>
                    </td>
                    <td className="hide-narrow">{detail || <span className="muted">—</span>}</td>
                    <td className="hide-narrow">{e.where === 'shopify' ? 'Shopify' : 'This audit'}</td>
                    <td className="end-cell">
                      {e.rolledBack ? (
                        <span className="caption muted">Rolled back</span>
                      ) : canRoll ? (
                        <button className="btn with-icon" onClick={() => writer.rollback(e.id)} aria-label={`Roll back: ${VERB[e.action]} ${e.discount}`}>
                          <Icon icon={ArrowTurnBackwardIcon} />
                          Roll back
                        </button>
                      ) : (
                        <span className="caption muted">Roll back the later change first</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
