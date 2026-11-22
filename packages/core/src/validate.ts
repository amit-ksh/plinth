import type { StoreInput } from './types.ts';

// IDs are compared in both JS and Cypher, so they are ASCII and exclude the pair-key separator.
const ID = /^[A-Za-z0-9_.:/-]{1,128}$/;
const CLASSES = new Set(['product', 'order', 'shipping']);

export class InputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Fix these input issues, then import again:\n${issues.join('\n')}`);
    this.name = 'InputError';
    this.issues = issues;
  }
}

/** Backups and agent input are untrusted, so check shapes before reading any field. */
function checkShape(input: StoreInput): void {
  const text = (v: unknown) => typeof v === 'string' && v.length <= 500;
  const texts = (v: unknown) => Array.isArray(v) && v.length <= 100_000 && v.every(text);
  const rows = (v: unknown) => Array.isArray(v) && v.length <= 100_000 && v.every((r) => r && typeof r === 'object');
  const ok =
    input &&
    typeof input.plus === 'boolean' &&
    rows(input.collections) && input.collections.every((c) => text(c.id) && text(c.title)) &&
    rows(input.variants) && input.variants.every((v) => text(v.id) && text(v.title) && texts(v.collections)) &&
    rows(input.discounts) &&
    input.discounts.every(
      (d) =>
        text(d.id) && text(d.title) && typeof d.allVariants === 'boolean' && typeof d.supported === 'boolean' &&
        texts(d.variants) && texts(d.collections) && texts(d.combinesWith) && texts(d.tags) && texts(d.acceptsTags),
    );
  if (!ok) throw new InputError(['The store data has missing or badly formed fields']);
}

export function validate(input: StoreInput): void {
  checkShape(input);
  const issues: string[] = [];
  const amount = (at: string, value: number, max = Number.MAX_SAFE_INTEGER) => {
    if (!Number.isSafeInteger(value) || value < 0 || value > max) issues.push(`${at}: use a whole number from 0 to ${max}`);
  };
  const ids = (kind: string, rows: { id: string }[]) => {
    const seen = new Set<string>();
    for (const { id } of rows) {
      if (!ID.test(id)) issues.push(`${kind} "${id}": use letters, numbers and _ . : / - in the ID`);
      if (seen.has(id)) issues.push(`${kind} "${id}": make the ID unique`);
      seen.add(id);
    }
    return seen;
  };

  const variants = ids('variant', input.variants);
  const collections = ids('collection', input.collections);
  ids('discount', input.discounts);

  for (const v of input.variants) {
    const at = `variant "${v.id}"`;
    amount(`${at} price`, v.price);
    if (v.cost !== null) amount(`${at} cost`, v.cost);
    for (const c of v.collections) {
      if (!collections.has(c)) issues.push(`${at}: collection "${c}" does not exist`);
    }
  }

  for (const d of input.discounts) {
    const at = `discount "${d.id}"`;
    if (!CLASSES.has(d.class)) issues.push(`${at}: class must be product, order or shipping`);
    if (d.method !== 'code' && d.method !== 'automatic') issues.push(`${at}: method must be code or automatic`);
    amount(`${at} bps`, d.bps, 10000);
    amount(`${at} off`, d.off);
    amount(`${at} minSubtotal`, d.minSubtotal);
    for (const c of d.combinesWith) {
      if (!CLASSES.has(c)) issues.push(`${at}: cannot combine with unknown class "${c}"`);
    }
    for (const v of d.variants) {
      if (!variants.has(v)) issues.push(`${at}: variant "${v}" does not exist`);
    }
    for (const c of d.collections) {
      if (!collections.has(c)) issues.push(`${at}: collection "${c}" does not exist`);
    }
    for (const t of [d.starts, d.ends]) {
      if (t !== null && !Number.isSafeInteger(t)) issues.push(`${at}: dates must be epoch milliseconds`);
    }
    if (d.starts !== null && d.ends !== null && d.starts >= d.ends) issues.push(`${at}: the end must be after the start`);
    // Silently treating either of these as "no effect" would produce a false Clear.
    if (d.supported && d.class === 'shipping' && (d.bps || d.off)) {
      issues.push(`${at}: partial shipping discounts are not modeled, so set supported to false`);
    }
    if (!d.allVariants && !d.variants.length && !d.collections.length) {
      issues.push(`${at}: choose what it applies to, or set allVariants`);
    }
  }

  if (issues.length) throw new InputError(issues);
}
