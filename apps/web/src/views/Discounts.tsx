import Add01Icon from '@hugeicons/core-free-icons/Add01Icon';
import ArrowRight01Icon from '@hugeicons/core-free-icons/ArrowRight01Icon';
import Delete02Icon from '@hugeicons/core-free-icons/Delete02Icon';
import DiscountTag01Icon from '@hugeicons/core-free-icons/DiscountTag01Icon';
import type { Discount } from '../../../../packages/core/src/types.ts';
import { useApp } from '../context.ts';
import { amountOf, DiscountForm, summarize } from '../DiscountForm.tsx';
import { call } from '../engine.ts';
import { Icon, Page } from '../ui.tsx';

// A colon can't be confused with a real code someone typed, because codes shown here come from the store.
const NEW = ':new';

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
      lead="What each one takes off, and what it can combine with."
      action={
        <a className="btn primary with-icon" href={`#discounts/${NEW}`}>
          <Icon icon={Add01Icon} strong />
          Add discount
        </a>
      }
    >
      {discounts.length ? (
        <ul className="rows">
          {discounts.map((d) => (
            <li key={d.id}>
              <a className="row" href={`#discounts/${encodeURIComponent(d.id)}`}>
                <span className="dot-icon"><Icon icon={DiscountTag01Icon} /></span>
                <span className="body">
                  <strong className="code">{d.id}</strong>
                  <span className="caption muted">{summarize(d, data.store, money)}</span>
                </span>
                <span className="end">
                  <span className="caption muted">
                    {d.ends !== null && d.ends <= now
                      ? 'Ended'
                      : !d.supported
                        ? amountOf(d, money)
                        : d.combinesWith.length
                          ? `With ${new Intl.ListFormat('en', { type: 'conjunction' }).format(d.combinesWith)}`
                          : 'Doesn’t combine'}
                  </span>
                  <Icon icon={ArrowRight01Icon} />
                </span>
              </a>
            </li>
          ))}
        </ul>
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
