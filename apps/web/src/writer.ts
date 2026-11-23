// One place that saves discount changes: to Shopify first when this audit is linked to a store,
// then to the local audit with a history entry. If Shopify refuses, nothing changes locally.
import type { ChecklistItem, HistoryAction } from '../../../packages/core/src/app-state.ts';
import { applyChanges } from '../../../packages/core/src/fixes.ts';
import type { Discount } from '../../../packages/core/src/types.ts';
import { useApp } from './context.ts';
import { call } from './engine.ts';
import { addShopifyCodes, noteOwnWrite, SHOPIFY_CONNECT, ShopifyError, writeShopify } from './shopify.ts';

/** Writes to Shopify and remembers the discount, so its own webhook isn't shown as an outside change. */
async function write(...args: Parameters<typeof writeShopify>) {
  const [, discount, previous, link] = args;
  noteOwnWrite(previous ? link.discounts[previous.id] : link.discounts[discount.id]);
  const result = await writeShopify(...args);
  noteOwnWrite(result.gid);
  return result;
}

export function useWriter() {
  const { data, change } = useApp();
  const link = SHOPIFY_CONNECT ? data.app.shopify : null;
  const where = link ? ('shopify' as const) : ('local' as const);
  const place = link ? 'Shopify' : 'this audit';

  const save = (discount: Discount, originalId: string | undefined, action?: HistoryAction, done?: string) =>
    change(async () => {
      const previous = originalId ? data.store.discounts.find((d) => d.id === originalId) ?? null : null;
      const gid = link ? (await write(previous ? 'update' : 'create', discount, previous, link)).gid : undefined;
      return call('saveDiscount', discount, originalId, { action, where, gid });
    }, done ?? `${discount.id} saved to ${place}`);

  const remove = (id: string) =>
    change(async () => {
      const current = data.store.discounts.find((d) => d.id === id)!;
      if (link) await write('delete', current, current, link);
      return call('deleteDiscount', id, { where });
    }, `${id} deleted from ${place}`);

  const rollback = (entryId: string) =>
    change(async () => {
      const plan = await call('rollbackPlan', entryId);
      let gid: string | null | undefined;
      if (link) {
        const kind = plan.kind;
        const target = kind === 'delete' ? plan.current! : plan.discount;
        gid = (await write(kind, target, kind === 'create' ? null : plan.current, link)).gid;
      }
      return call('rollback', entryId, { where, gid });
    }, `Rolled back in ${place}`);

  /** Makes a checklist fix: in Shopify first when linked, then marks it as made here. */
  const applyFix = (item: ChecklistItem) =>
    change(async () => {
      if (link) {
        const next = applyChanges(data.store, item.changes, Date.now());
        for (const after of next.discounts) {
          const before = data.store.discounts.find((d) => d.id === after.id)!;
          if (JSON.stringify(before) !== JSON.stringify(after)) await write('update', after, before, link);
        }
      }
      return call('completeChecklistItem', item.id, { where });
    }, link ? 'Changed in Shopify and audit updated' : 'Marked as made and audit updated');

  /** Ends every live discount now, as one batch. In Shopify first when linked; only the ones Shopify accepts are paused here. */
  const pauseAll = () => {
    const done: string[] = [];
    const failed: string[] = [];
    return change(async () => {
      const live = await call('pausePlan');
      const at = Date.now();
      for (const d of live) {
        try {
          if (link) await write('update', { ...d, ends: at }, d, link);
          done.push(d.id);
        } catch {
          failed.push(d.id);
        }
      }
      if (!done.length) throw new ShopifyError(['Shopify refused every change, so nothing was paused'], 0);
      return call('pauseAll', done, { where, at });
    }, () =>
      failed.length
        ? `Paused ${done.length} in ${place}. Shopify refused ${failed.join(', ')}, which ${failed.length === 1 ? 'is' : 'are'} still live`
        : `Paused ${done.length} live ${done.length === 1 ? 'discount' : 'discounts'} in ${place}`);
  };

  /** Puts a paused batch back. */
  const resumeAll = (batch: string) => {
    const done: string[] = [];
    let total = 0;
    return change(async () => {
      const plan = await call('batchPlan', batch);
      total = plan.length;
      for (const p of plan) {
        try {
          if (link) await write('update', p.before, p.current, link);
          done.push(p.entry);
        } catch {
          // Left paused; it stays in the batch so Resume all can try again.
        }
      }
      if (!done.length) throw new ShopifyError(['Shopify refused every change, so nothing was resumed'], 0);
      return call('rollbackBatch', batch, done, { where });
    }, () => (done.length === total ? `Resumed ${done.length} in ${place}` : `Resumed ${done.length} of ${total}. Try Resume all again for the rest`));
  };

  /** Adds generated codes to a code discount in Shopify. */
  const addCodes = async (discount: Discount, codes: string[]) => {
    if (!link) return 0;
    const gid = link.discounts[discount.id];
    if (!gid) throw new Error('This discount isn’t in Shopify yet');
    return (await addShopifyCodes(gid, codes)).queued;
  };

  return { save, remove, rollback, applyFix, pauseAll, resumeAll, addCodes, linked: !!link, shop: link?.shop ?? null, place };
}
