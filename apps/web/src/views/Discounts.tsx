import Add01Icon from '@hugeicons/core-free-icons/Add01Icon';
import Delete02Icon from '@hugeicons/core-free-icons/Delete02Icon';
import DiscountTag01Icon from '@hugeicons/core-free-icons/DiscountTag01Icon';
import type { Discount } from '../../../../packages/core/src/types.ts';
import { useApp } from '../context.ts';
import { amountOf, DiscountForm, summarize, targetOf } from '../DiscountForm.tsx';
import { call } from '../engine.ts';
import { Icon, Page } from '../ui.tsx';

// A colon can't be confused with a real code someone typed, because codes shown here come from the store.
const NEW = ':new';

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const CLASS_NAME = { product: 'Product', order: 'Order', shipping: 'Shipping' } as const;

const blank = (): Discount => ({
  id: '', title: '', class: 'product', method: 'code', bps: 0, off: 0, allVariants: true, variants: [], collections: [],
  minSubtotal: 0, combinesWith: [], tags: [], acceptsTags: [], starts: null, ends: null, supported: true,
});

function Editor({ id }: { id: string }) {
  const { data, change, money } = useApp();
  const adding = id === NEW;
  const existing = data.store.discounts.find((d) => d.id === id);
  const back = { href: '#discounts', label: 'Discounts' };

  if (!adding && !existing) {
    return <Page title="Discount not found" lead="It may have been removed or replaced by an import." back={back} />;
  }

  const save = async (discount: Discount) => {
    const named = { ...discount, title: discount.title || discount.id };
    const done = await change(() => call('saveDiscount', named, adding ? undefined : id), `${named.id} saved and audit updated`);
    if (done) location.hash = 'discounts';
  };

  const remove = async () => {
    if (await change(() => call('deleteDiscount', id), `${id} removed from this audit`)) location.hash = 'discounts';
  };

  return (
    <Page
      title={adding ? 'Add a discount' : id}
      lead={adding ? 'It’s added to this audit only. Nothing is sent to Shopify.' : summarize(existing!, data.store, money)}
      back={back}
    >
      <div className="card">
        <DiscountForm key={id} initial={existing ?? blank()} submitLabel={adding ? 'Add discount' : 'Save changes'} onSubmit={save} />
      </div>
      {!adding && (
        <div className="actions">
          <button className="btn with-icon" onClick={remove}>
            <Icon icon={Delete02Icon} />
            Remove from audit
          </button>
        </div>
      )}
    </Page>
  );
}

export function Discounts({ id }: { id?: string }) {
  const { data, money } = useApp();
  if (id) return <Editor id={id} />;
  const now = Date.now();
  const { discounts } = data.store;

  return (
    <Page
      title="Discounts"
      wide
      lead="What each one takes off, and what it can combine with."
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
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => {
                const ended = d.ends !== null && d.ends <= now;
                const scheduled = d.starts !== null && d.starts > now;
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
                    <td>
                      <span className={`status ${!d.supported ? 'unknown' : ended || scheduled ? 'off' : 'on'}`}>
                        {!d.supported ? 'Can’t be sure' : ended ? 'Ended' : scheduled ? 'Scheduled' : 'Active'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card">
          <h2>No discounts yet</h2>
          <p>Add the discounts running in your store, or import them from a file.</p>
          <div className="actions"><a className="btn" href="#import">Import discounts</a></div>
        </div>
      )}
    </Page>
  );
}
