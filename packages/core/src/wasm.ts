import init, { RelateDb } from '@relate/relate-wasm';
import type { Driver } from './types.ts';

/**
 * Opens Relate WASM in memory, or at opfs://name inside a dedicated worker.
 * Each statement commits alone, so import into a new store and switch only after it loads.
 */
export async function openWasm(options: { wasm?: BufferSource | string | URL; uri?: string } = {}): Promise<Driver> {
  await init(options.wasm === undefined ? undefined : { module_or_path: options.wasm });
  const db = options.uri ? await RelateDb.open(options.uri) : new RelateDb();
  return {
    query<T>(cypher: string, params: Record<string, unknown> = {}): T[] {
      const result = JSON.parse(db.execute(cypher, JSON.stringify(params)));
      if (result.error) {
        throw new Error(`Relate: ${typeof result.error === 'string' ? result.error : JSON.stringify(result.error)}`);
      }
      return result.rows as T[];
    },
    transaction: (work) => work(),
  };
}
