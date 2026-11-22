import { createContext, useContext } from 'react';
import { formatMoney } from '../../../packages/core/src/format.ts';
import type { Snapshot } from '../../../packages/core/src/workspace.ts';

export interface AppContext {
  data: Snapshot;
  /** Runs a change, shows its result and offers undo. Returns false when it failed. */
  change: (work: () => Promise<Snapshot>, done: string) => Promise<boolean>;
  notify: (message: string) => void;
  query: string;
  setQuery: (query: string) => void;
}

export const Context = createContext<AppContext | null>(null);

export function useApp() {
  const app = useContext(Context)!;
  const { currency } = app.data.app.settings;
  return { ...app, money: (minor: number) => formatMoney(minor, currency) };
}

export type Route = { view: string; id?: string };

export function readRoute(hash: string): Route {
  const [view, id] = hash.replace(/^#/, '').split('/');
  let decoded = id;
  try {
    decoded = id && decodeURIComponent(id);
  } catch {
    // A hand-edited hash. The product screen reports it as not found.
  }
  return { view: view || 'home', id: decoded };
}

export const productHref = (id: string) => `#product/${encodeURIComponent(id)}`;

/** An amount in an editable field: 125050 becomes "1250.50". */
export const editable = (minor: number) => (minor / 100).toFixed(2);
