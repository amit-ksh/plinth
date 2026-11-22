import { Database } from '@relate/relate';
import type { Driver } from './types.ts';

export interface NativeDriver extends Driver {
  checkpoint(): void;
}

/**
 * Opens a directory store or ':memory:'. Use a directory, never a single .rl file:
 * on Windows a second process cannot read a .rl file while it is being written.
 */
export function openNative(path: string, options: { readOnly?: boolean } = {}): NativeDriver {
  const database = Database.open(path, options);
  const connection = database.connect();
  return {
    query: <T>(cypher: string, params: Record<string, unknown> = {}) =>
      connection.query(cypher, params as never).rows as T[],
    transaction(work) {
      connection.begin();
      try {
        const value = work();
        connection.commit();
        return value;
      } catch (error) {
        connection.rollback();
        throw error;
      }
    },
    checkpoint: () => database.checkpoint(),
  };
}
