// One place that saves discount changes: to Shopify first when this audit is linked to a store,
// then to the local audit with a history entry. If Shopify refuses, nothing changes locally.
import type { ChecklistItem, HistoryAction } from '../../../packages/core/src/app-state.ts';
import { applyChanges } from '../../../packages/core/src/fixes.ts';
import type { Discount } from '../../../packages/core/src/types.ts';
import { useApp } from './context.ts';
import { call } from './engine.ts';
import { SHOPIFY_CONNECT, writeShopify } from './shopify.ts';

export function useWriter() {
  const { data, change } = useApp();
  const link = SHOPIFY_CONNECT ? data.app.shopify : null;
  const where = link ? ('shopify' as const) : ('local' as const);
  const place = link ? 'Shopify' : 'this audit';

  const save = (discount: Discount, originalId: string | undefined, action?: HistoryAction, done?: string) =>
    change(async () => {
      const previous = originalId ? data.store.discounts.find((d) => d.id === originalId) ?? null : null;
      const gid = link ? (await writeShopify(previous ? 'update' : 'create', discount, previous, link)).gid : undefined;
      return call('saveDiscount', discount, originalId, { action, where, gid });
    }, done ?? `${discount.id} saved to ${place}`);

  const remove = (id: string) =>
    change(async () => {
      const current = data.store.discounts.find((d) => d.id === id)!;
      if (link) await writeShopify('delete', current, current, link);
      return call('deleteDiscount', id, { where });
    }, `${id} deleted from ${place}`);

  const rollback = (entryId: string) =>
    change(async () => {
      const plan = await call('rollbackPlan', entryId);
      let gid: string | null | undefined;
      if (link) {
        const kind = plan.kind;
        const target = kind === 'delete' ? plan.current! : plan.discount;
        gid = (await writeShopify(kind, target, kind === 'create' ? null : plan.current, link)).gid;
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
          if (JSON.stringify(before) !== JSON.stringify(after)) await writeShopify('update', after, before, link);
        }
      }
      return call('completeChecklistItem', item.id, { where });
    }, link ? 'Changed in Shopify and audit updated' : 'Marked as made and audit updated');

  return { save, remove, rollback, applyFix, linked: !!link, shop: link?.shop ?? null, place };
}
