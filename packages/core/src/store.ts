import * as Q from './queries.ts';
import type { Driver, StoreInput } from './types.ts';
import { validate } from './validate.ts';

/** Builds a graph in an empty database. To replace a store, build a new one and switch to it. */
export function loadStore(db: Driver, input: StoreInput): void {
  validate(input);
  if (Number(db.query<{ n: number }>(Q.IS_EMPTY)[0].n) !== 0) {
    throw new Error('This store already has data. Import into a new, empty store.');
  }
  for (const statement of Q.INDEXES) db.query(statement);

  const edges = <T extends { id: string }>(rows: T[], pick: (row: T) => readonly string[]) =>
    rows.flatMap((row) => [...new Set(pick(row))].map((to) => ({ from: row.id, to })));
  const { variants, discounts, collections } = input;

  const steps: [string, unknown[]][] = [
    [Q.CREATE_COLLECTIONS, collections],
    [Q.CREATE_VARIANTS, variants.map(({ id, title, price, cost, image }) => ({ id, title, price, cost, image: image ?? null }))],
    [
      Q.CREATE_DISCOUNTS,
      discounts.map((d) => ({
        id: d.id, title: d.title, class: d.class, method: d.method, bps: d.bps, off: d.off,
        allVariants: d.allVariants, minSubtotal: d.minSubtotal, supported: d.supported, starts: d.starts, ends: d.ends,
      })),
    ],
    [Q.CREATE_TAGS, [...new Set(discounts.flatMap((d) => [...d.tags, ...d.acceptsTags]))]],
    [Q.LINK_IN, edges(variants, (v) => v.collections)],
    [Q.LINK_VARIANT, edges(discounts, (d) => d.variants)],
    [Q.LINK_COLLECTION, edges(discounts, (d) => d.collections)],
    [Q.LINK_ALLOWS, edges(discounts, (d) => d.combinesWith)],
    [Q.LINK_HAS_TAG, edges(discounts, (d) => d.tags)],
    [Q.LINK_ACCEPTS_TAG, edges(discounts, (d) => d.acceptsTags)],
  ];

  db.transaction(() => {
    db.query(Q.CREATE_STORE, { plus: input.plus });
    db.query(Q.CREATE_CLASSES);
    for (const [statement, rows] of steps) {
      if (rows.length) db.query(statement, { rows });
    }
    db.query(Q.DERIVE_PAIRS);
  });
}
