import { parseMoney, parsePercent } from './format.ts';
import type { Discount, DiscountClass, StoreInput, Variant } from './types.ts';
import { InputError, isImageUrl, validate } from './validate.ts';

const MAX_LENGTH = 5_000_000;

export const PRODUCTS_TEMPLATE = `id,title,price,cost,collections
jacket,Winter jacket,100.00,65.00,Winter
boots,Leather boots,100.00,62.00,Footwear
`;

export const DISCOUNTS_TEMPLATE = `code,title,class,type,method,percent,amount,applies_to,min_subtotal,combines_with,tags,accepts_tags,starts,ends
BUNDLE20,20% off winter,product,percent,code,20,,collection:Winter,,order;shipping,,,,
WELCOME15,15% welcome,order,percent,code,15,,all,,product;shipping,,,,
FREESHIP,Free shipping,shipping,free_shipping,code,,,all,50.00,product;order,,,,
`;

interface Row {
  line: number;
  values: Record<string, string>;
}

/** RFC 4180: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const source = text.replace(/^﻿/, '');
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let start = 1;

  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim())) rows.push({ line: start, cells: cells.map((c) => c.trim()) });
    cells = [];
    cell = '';
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\n') line++;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (source[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') {
        i++;
        line++;
      }
      endRow();
      start = line;
    } else cell += ch;
  }
  if (quoted) throw new InputError([`line ${start}: close the quote, then import again`]);
  endRow();
  return rows;
}

function table(file: string, text: string, required: string[], issues: string[]): Row[] {
  if (text.length > MAX_LENGTH) {
    issues.push(`${file}: use a file under 5 MB`);
    return [];
  }
  let rows: ReturnType<typeof parseCsv>;
  try {
    rows = parseCsv(text);
  } catch (error) {
    issues.push(...(error as InputError).issues.map((issue) => `${file}, ${issue}`));
    return [];
  }
  if (!rows.length) {
    issues.push(`${file}: add a header row and at least one row`);
    return [];
  }
  const head = rows[0].cells.map((h) => h.toLowerCase());
  const missing = required.filter((name) => !head.includes(name));
  if (missing.length) {
    issues.push(`${file}, line 1: add the column ${missing.join(', ')}`);
    return [];
  }
  return rows.slice(1).flatMap(({ line, cells }) => {
    if (cells.length > head.length) {
      issues.push(`${file}, line ${line}: there are more values than columns, so put values with commas in quotes`);
      return [];
    }
    return [{ line, values: Object.fromEntries(head.map((name, i) => [name, cells[i] ?? ''])) }];
  });
}

function listOf(value = ''): string[] {
  return [...new Set(value.split(';').map((v) => v.trim()).filter(Boolean))];
}

/** Turns a collection name into an ID. Names outside A-Z get a stable hash instead of being merged. */
function collectionId(title: string): string {
  const lower = title.trim().toLowerCase();
  const ascii = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  if (/^[a-z0-9 -]+$/.test(lower) && ascii) return ascii;
  let hash = 2166136261;
  for (const ch of lower) hash = Math.imul(hash ^ ch.codePointAt(0)!, 16777619);
  return `${ascii || 'collection'}-${(hash >>> 0).toString(36)}`;
}

export function importCsv(files: { products: string; discounts: string }, plus: boolean): StoreInput {
  const issues: string[] = [];
  const P = 'products.csv';
  const D = 'discounts.csv';
  const collections = new Map<string, { id: string; title: string }>();
  const variants: Variant[] = [];
  const discounts: Discount[] = [];

  const seenProducts = new Set<string>();
  for (const { line, values: r } of table(P, files.products, ['id', 'title', 'price', 'cost', 'collections'], issues)) {
    const at = `${P}, line ${line}`;
    const price = parseMoney(r.price);
    const cost = r.cost ? parseMoney(r.cost) : null;
    if (!r.id) issues.push(`${at}: add an id`);
    else if (seenProducts.has(r.id)) issues.push(`${at}: id “${r.id}” is already used, so make it unique`);
    seenProducts.add(r.id);
    if (price === null) issues.push(`${at}: write the price like 49.99`);
    if (r.cost && cost === null) issues.push(`${at}: write the cost like 24.50, or leave it empty`);

    const member = new Set<string>();
    for (const title of listOf(r.collections)) {
      const id = collectionId(title);
      if (!collections.has(id)) collections.set(id, { id, title });
      member.add(id);
    }
    const image = (r.image || r['image src'] || '').trim();
    if (image && !isImageUrl(image)) issues.push(`${at}: use an image link that starts with https://, or leave it empty`);
    variants.push({ id: r.id, title: r.title || r.id, price: price ?? 0, cost, collections: [...member], ...(image ? { image } : {}) });
  }
  if (!variants.length && !issues.length) issues.push(`${P}: add at least one product`);

  const seenCodes = new Set<string>();
  for (const { line, values: r } of table(D, files.discounts, ['code', 'class', 'applies_to', 'combines_with'], issues)) {
    const at = `${D}, line ${line}`;
    const cls = r.class.toLowerCase() as DiscountClass;
    if (!['product', 'order', 'shipping'].includes(cls)) issues.push(`${at}: class must be product, order or shipping`);

    if (!/^[A-Za-z0-9_./:-]{1,128}$/.test(r.code)) issues.push(`${at}: use letters, numbers, - or _ in the code`);
    else if (seenCodes.has(r.code)) issues.push(`${at}: code “${r.code}” is already used, so make it unique`);
    seenCodes.add(r.code);

    const type = (r.type ?? '').toLowerCase();
    // Anything unrecognized is kept and marked unsupported, so it shows as Unknown instead of vanishing.
    const supported = ['', 'percent', 'percentage', 'fixed', 'amount', 'free_shipping'].includes(type);
    const bps = r.percent ? parsePercent(r.percent) : 0;
    const off = r.amount ? parseMoney(r.amount) : 0;
    const minSubtotal = r.min_subtotal ? parseMoney(r.min_subtotal) : 0;
    if (bps === null) issues.push(`${at}: write percent as a number from 0 to 100`);
    if (off === null) issues.push(`${at}: write amount like 10.00`);
    if (minSubtotal === null) issues.push(`${at}: write min_subtotal like 50.00`);
    if (supported) {
      if (cls === 'shipping' && (bps || off)) issues.push(`${at}: set type to partial_shipping, because only free shipping is modeled`);
      if (cls !== 'shipping' && !bps && !off && !r.percent && !r.amount) issues.push(`${at}: add a percent or an amount`);
    }

    const method = (r.method || 'code').toLowerCase();
    if (method !== 'code' && method !== 'automatic') issues.push(`${at}: method must be code or automatic`);

    const combinesWith = listOf(r.combines_with.toLowerCase()) as DiscountClass[];
    if (combinesWith.some((c) => !['product', 'order', 'shipping'].includes(c))) {
      issues.push(`${at}: combines_with takes product, order or shipping, separated by semicolons`);
    }

    const date = (column: 'starts' | 'ends') => {
      if (!r[column]) return null;
      const time = Date.parse(r[column]);
      if (Number.isFinite(time) && /^\d{4}-\d{2}-\d{2}/.test(r[column])) return time;
      issues.push(`${at}: write ${column} like 2026-12-01`);
      return null;
    };
    const starts = date('starts');
    const ends = date('ends');
    if (starts !== null && ends !== null && starts >= ends) issues.push(`${at}: ends must be after starts`);

    const targets = new Set<string>();
    const inCollections = new Set<string>();
    let allVariants = false;
    const scope = listOf(r.applies_to);
    if (!scope.length) issues.push(`${at}: set applies_to to all, product:<id> or collection:<name>`);
    for (const item of scope) {
      if (item.toLowerCase() === 'all') allVariants = true;
      else if (item.startsWith('product:')) {
        const id = item.slice(8).trim();
        if (seenProducts.has(id)) targets.add(id);
        else issues.push(`${at}: product “${id}” is not in ${P}`);
      } else if (item.startsWith('collection:')) {
        const title = item.slice(11).trim();
        const id = collectionId(title);
        if (collections.has(id)) inCollections.add(id);
        else issues.push(`${at}: collection “${title}” is not in ${P}`);
      } else issues.push(`${at}: “${item}” needs product: or collection: in front of it`);
    }

    discounts.push({
      id: r.code,
      title: r.title || r.code,
      class: cls,
      method: method as Discount['method'],
      bps: bps ?? 0,
      off: off ?? 0,
      allVariants,
      variants: [...targets],
      collections: [...inCollections],
      minSubtotal: minSubtotal ?? 0,
      combinesWith,
      tags: listOf(r.tags),
      acceptsTags: listOf(r.accepts_tags),
      starts,
      ends,
      supported,
    });
  }

  if (issues.length) throw new InputError(issues);
  const store = { plus, collections: [...collections.values()], variants, discounts };
  validate(store);
  return store;
}
