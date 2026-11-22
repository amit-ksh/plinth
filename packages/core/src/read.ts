import * as Q from './queries.ts';
import type { Discount, DiscountClass, Driver, StoreInput, Variant } from './types.ts';

function grouped(rows: { from: string; to: string }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const { from, to } of rows) map.set(from, [...(map.get(from) ?? []), to].sort());
  return map;
}

/** Reads the whole store back out of the graph, which is the only copy of the data. */
export function readStore(db: Driver): StoreInput {
  const links = (query: string) => grouped(db.query<{ from: string; to: string }>(query));
  const inCollection = links(Q.READ_IN);
  const toVariant = links(Q.READ_TO_VARIANT);
  const toCollection = links(Q.READ_TO_COLLECTION);
  const allows = links(Q.READ_ALLOWS);
  const tags = links(Q.READ_HAS_TAG);
  const accepts = links(Q.READ_ACCEPTS_TAG);

  return {
    plus: Boolean(db.query<{ plus: boolean }>(Q.READ_PLUS)[0]?.plus),
    collections: db.query<{ id: string; title: string }>(Q.READ_COLLECTIONS),
    variants: db.query<Omit<Variant, 'collections'>>(Q.VARIANTS).map((v) => ({
      id: v.id,
      title: v.title,
      price: v.price,
      cost: v.cost ?? null,
      collections: inCollection.get(v.id) ?? [],
    })),
    discounts: db.query<Discount>(Q.READ_DISCOUNTS).map((d) => ({
      id: d.id,
      title: d.title,
      class: d.class,
      method: d.method,
      bps: d.bps,
      off: d.off,
      allVariants: d.allVariants,
      variants: toVariant.get(d.id) ?? [],
      collections: toCollection.get(d.id) ?? [],
      minSubtotal: d.minSubtotal,
      combinesWith: (allows.get(d.id) ?? []) as DiscountClass[],
      tags: tags.get(d.id) ?? [],
      acceptsTags: accepts.get(d.id) ?? [],
      starts: d.starts ?? null,
      ends: d.ends ?? null,
      supported: d.supported,
    })),
  };
}
