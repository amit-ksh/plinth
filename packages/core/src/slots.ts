import * as Q from './queries.ts';
import type { Persistence, Saved } from './workspace.ts';
import type { Driver } from './types.ts';

/**
 * Two graphs. A save builds the idle one and marks it complete last, so an interrupted
 * save leaves the previous graph in charge. WASM has no multi-statement transaction.
 */
export function createSlots(slots: readonly [Driver, Driver], scratch: Driver, saved: Saved): Persistence {
  const generations = slots.map((db) => Number(db.query<{ generation: number }>(Q.READ_COMPLETE)[0]?.generation ?? 0));
  let current = !generations[0] && !generations[1] ? -1 : generations[0] >= generations[1] ? 0 : 1;

  return {
    saved,
    active: () => (current < 0 ? null : slots[current]),
    replace(build) {
      const target = current === 0 ? 1 : 0;
      const db = slots[target];
      db.query(Q.UNMARK_COMPLETE);
      db.query(Q.CLEAR);
      generations[target] = 0;
      build(db);
      const generation = Math.max(...generations) + 1;
      db.query(Q.MARK_COMPLETE, { generation });
      generations[target] = generation;
      current = target;
    },
    scratch() {
      scratch.query(Q.CLEAR);
      return scratch;
    },
  };
}
