import { createContext, useContext } from 'react';
import { formatMoney } from '../../../packages/core/src/format.ts';
import type { Snapshot } from '../../../packages/core/src/workspace.ts';

export interface AppContext {
  data: Snapshot;
  /** Runs a change, shows its result and offers undo. Returns false when it failed. */
  change: (work: () => Promise<Snapshot>, done: string | (() => string)) => Promise<boolean>;
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

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A start time as a date field value. Dates are days in this browser's time zone. */
export const startField = (ms: number | null) => (ms === null ? '' : ymd(new Date(ms)));
/** An end time as the last day it runs: a sale ending at midnight on the 2nd runs through the 1st. */
export const endField = (ms: number | null) => (ms === null ? '' : ymd(new Date(ms - 1)));

/** A date field as a start time: the start of that day. */
export function fromStartField(value: string): number | null | undefined {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : undefined;
}
/** A date field as an end time: the end of that day, which is midnight after it. */
export function fromEndField(value: string): number | null | undefined {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1).getTime() : undefined;
}

const DAY_FORMAT = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' });
export const formatDay = (ms: number) => DAY_FORMAT.format(new Date(ms));
/** "Mon 23 Nov to Thu 26 Nov", for a stretch that ends at midnight. */
export const formatStretch = (start: number, end: number) => {
  const last = end - 1;
  return new Date(start).toDateString() === new Date(last).toDateString() ? formatDay(start) : `${formatDay(start)} to ${formatDay(last)}`;
};
