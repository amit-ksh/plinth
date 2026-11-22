import * as Q from './queries.ts';
import type { AuditResult, DiscountClass, Driver, StoreInput } from './types.ts';

/** A change that exists as a real setting. Shopify has no switch for a single pair. */
export type Change =
  | { kind: 'class'; discount: string; value: DiscountClass }
  | { kind: 'tag'; discount: string; value: string }
  | { kind: 'end'; discount: string };

export interface Fix {
  id: string;
  changes: Change[];
  /** Edge keys and discounts to take out when previewing. */
  removed: string[];
  disabled: string[];
  /** Leaking products that this change clears completely. */
  closes: string[];
  /** Stacks that never lose money and would stop working. */
  breaks: string[][];
}

interface Neighbor {
  discount: string;
  otherClass: DiscountClass;
  key: string;
  /** Tags that `discount` accepts and the other one carries. */
  shared: string[];
}

type Cut = Pick<Fix, 'changes' | 'removed' | 'disabled'>;

export function changeId(changes: readonly Change[]): string {
  return changes.map((c) => [c.kind, c.discount, 'value' in c ? c.value : ''].join('~')).join('+');
}

function cutter(cut: Cut): (stack: readonly string[]) => boolean {
  const disabled = new Set(cut.disabled);
  const removed = new Set(cut.removed);
  return (stack) => {
    for (let i = 0; i < stack.length; i++) {
      if (disabled.has(stack[i])) return true;
      if (!removed.size) continue;
      // Stacks are sorted by ID, the same order the edge keys use.
      for (let j = i + 1; j < stack.length; j++) if (removed.has(`${stack[i]}|${stack[j]}`)) return true;
    }
    return false;
  };
}

const PREFERENCE = { shipping: 0, order: 1, product: 2 } as const;
function preference({ changes }: Cut): number {
  const first = changes[0];
  if (changes.length > 1) return 20;
  if (first.kind === 'end') return 10;
  return first.kind === 'class' ? PREFERENCE[first.value] : 1;
}

/**
 * Ranks changes that close every leak on one product: fewest profitable stacks broken first.
 * `result` must come from an audit with `collectLeaks`. Taking out pairs or discounts can only
 * remove groups, so a change clears a product exactly when it cuts each of its leaking stacks.
 */
export function suggestFixes(db: Driver, store: StoreInput, result: AuditResult, variantId: string): Fix[] {
  const target = result.variants.find((v) => v.id === variantId);
  // With no stack in a leak, the price itself is below cost and no setting can fix it.
  if (!target?.leaks.length || target.leaks.some((l) => !l.stack.length)) return [];

  const involved = [...new Set(target.leaks.flatMap((l) => l.stack))].sort();
  const neighbors = db.query<Neighbor>(Q.NEIGHBORS, { ids: involved });

  const candidates: Cut[] = [];
  for (const id of involved) {
    const discount = store.discounts.find((d) => d.id === id);
    if (!discount) continue;
    const around = neighbors.filter((n) => n.discount === id);

    for (const value of discount.combinesWith) {
      const removed = around.filter((n) => n.otherClass === value).map((n) => n.key);
      if (removed.length) candidates.push({ changes: [{ kind: 'class', discount: id, value }], removed, disabled: [] });
    }
    if (discount.class === 'product') {
      for (const value of discount.acceptsTags) {
        const removed = around
          .filter((n) => n.otherClass === 'product' && n.shared.length === 1 && n.shared[0] === value)
          .map((n) => n.key);
        if (removed.length) candidates.push({ changes: [{ kind: 'tag', discount: id, value }], removed, disabled: [] });
      }
    }
    candidates.push({ changes: [{ kind: 'end', discount: id }], removed: [], disabled: [id] });
  }

  let closing = candidates.filter((c) => {
    const cuts = cutter(c);
    return target.leaks.every((l) => cuts(l.stack));
  });

  if (!closing.length) {
    // Several independent leaks. Combine changes, taking whichever cuts the most each round.
    const plan: Cut = { changes: [], removed: [], disabled: [] };
    let open = target.leaks;
    while (open.length) {
      let best: Cut | undefined;
      let most = 0;
      for (const candidate of candidates) {
        const cuts = cutter(candidate);
        const count = open.filter((l) => cuts(l.stack)).length;
        if (count > most || (count === most && best && preference(candidate) < preference(best))) {
          most = count;
          best = candidate;
        }
      }
      if (!best) return [];
      plan.changes.push(...best.changes);
      plan.removed.push(...best.removed);
      plan.disabled.push(...best.disabled);
      const cuts = cutter(plan);
      open = open.filter((l) => !cuts(l.stack));
    }
    closing = [plan];
  }

  const leaking = result.variants.filter((v) => v.leaks.length);
  const leakKeys = new Set(leaking.flatMap((v) => v.leaks.map((l) => l.stack.join('|'))));
  const profitable = (result.groups ?? []).filter((g) => !leakKeys.has(g.join('|')));

  return closing
    .map((c) => {
      const cuts = cutter(c);
      return {
        ...c,
        id: changeId(c.changes),
        closes: leaking.filter((v) => v.leaks.every((l) => cuts(l.stack))).map((v) => v.id),
        breaks: profitable.filter(cuts),
      };
    })
    .sort(
      (a, b) =>
        Number(preference(a) >= 10) - Number(preference(b) >= 10) ||
        a.breaks.length - b.breaks.length ||
        b.closes.length - a.closes.length ||
        preference(a) - preference(b) ||
        (a.id < b.id ? -1 : 1),
    );
}

/** The same change made to the data, for when the merchant has made it in Shopify. */
export function applyChanges(store: StoreInput, changes: readonly Change[], now: number): StoreInput {
  let { discounts } = store;
  for (const change of changes) {
    const target = discounts.find((d) => d.id === change.discount);
    if (!target) throw new Error(`${change.discount} is no longer in this audit. Run the audit again for a new fix.`);

    if (change.kind === 'end') {
      // A discount that has not started cannot end now, so it leaves the audit instead.
      discounts =
        target.starts !== null && target.starts >= now
          ? discounts.filter((d) => d !== target)
          : discounts.map((d) => (d === target ? { ...d, ends: now } : d));
    } else if (change.kind === 'class') {
      discounts = discounts.map((d) =>
        d === target ? { ...d, combinesWith: d.combinesWith.filter((c) => c !== change.value) } : d,
      );
    } else {
      discounts = discounts.map((d) =>
        d === target ? { ...d, acceptsTags: d.acceptsTags.filter((t) => t !== change.value) } : d,
      );
    }
  }
  return { ...store, discounts };
}
