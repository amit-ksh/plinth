import CheckmarkCircle02Icon from '@hugeicons/core-free-icons/CheckmarkCircle02Icon';
import { describeChange } from '../../../../packages/core/src/format.ts';
import { useApp } from '../context.ts';
import { call } from '../engine.ts';
import { Icon, Page } from '../ui.tsx';

export function Checklist() {
  const { data, change } = useApp();
  const open = data.app.checklist.filter((item) => !item.done);
  const done = data.app.checklist.filter((item) => item.done);
  const focusTitle = () => document.querySelector<HTMLElement>('main h1')?.focus();

  return (
    <Page title="Checklist" lead="Make each change in Shopify, then mark it as made. The audit updates straight away.">
      {open.length ? (
        <ul className="rows">
          {open.map((item, i) => (
            <li className="card" key={item.id}>
              <div className="section">
                {item.changes.map((c, j) => {
                  const { title, setting } = describeChange(c);
                  return (
                    <div key={j}>
                      <h2>{title}</h2>
                      <p className="caption muted">{setting}</p>
                    </div>
                  );
                })}
                {item.products.length > 0 && <p className="caption">For {item.products.join(', ')}</p>}
              </div>
              <div className="actions">
                <button
                  className={i === 0 ? 'btn primary' : 'btn'}
                  onClick={async () => {
                    if (await change(() => call('completeChecklistItem', item.id), 'Marked as made and audit updated')) focusTitle();
                  }}
                >
                  I made this change
                </button>
                <button
                  className="btn"
                  onClick={async () => {
                    if (await change(() => call('removeFromChecklist', item.id), 'Removed from your checklist')) focusTitle();
                  }}
                >
                  Remove from checklist
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card">
          <h2>Nothing to change</h2>
          <p>Open a product that sells below cost and add its fix here.</p>
          <div className="actions"><a className="btn primary" href="#audit">Open the audit</a></div>
        </div>
      )}

      {done.length > 0 && (
        <section className="section" aria-labelledby="done">
          <h2 id="done">Made</h2>
          <ul className="rows">
            {done.map((item) => (
              <li className="row" key={item.id}>
                <span className="dot-icon"><Icon icon={CheckmarkCircle02Icon} /></span>
                <span className="body">{item.changes.map((c) => describeChange(c).title).join(', then ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}
