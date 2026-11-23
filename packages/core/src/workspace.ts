import { audit, explainStack } from './audit.ts';
import {
  checkSettings, checkState, defaultState, HISTORY_LIMIT, type AppState, type HistoryAction, type HistoryEntry, type Settings, type ShopifyLink,
} from './app-state.ts';
import { importCsv } from './csv.ts';
import { applyChanges, changeId, suggestFixes, type Change, type Fix } from './fixes.ts';
import { breakdown, type ReceiptLine } from './money.ts';
import type { Currency } from './format.ts';
import { PRODUCT_NAME } from './product.ts';
import { parsePromotion, type PromotionParse } from './promotion.ts';
import * as Q from './queries.ts';
import { readStore } from './read.ts';
import { buildReport } from './report.ts';
import { SAMPLE_STORE } from './sample.ts';
import { loadStore } from './store.ts';
import type {
  AuditResult, Discount, Driver, Outcome, PairRule, Scenario, StoreInput, UnknownReason, VariantAudit,
} from './types.ts';
import { InputError, validate } from './validate.ts';

export type Saved = 'device' | 'memory' | 'locked' | 'unavailable' | 'read-only';

/** Where the graph lives. Each surface supplies one. */
export interface Persistence {
  readonly saved: Saved;
  active(): Driver | null;
  /** Switches to a newly built graph, and only once `build` has finished. */
  replace(build: (db: Driver) => void): void;
  /** An empty in-memory graph for what-ifs. */
  scratch(): Driver;
}

export interface Snapshot {
  store: StoreInput;
  app: AppState;
  audit: AuditResult;
  saved: Saved;
  canUndo: boolean;
}

export interface Explained {
  outcome: Outcome;
  lines: ReceiptLine[];
  pairs: PairRule[];
}

export interface ProductDetail {
  row: VariantAudit;
  worst: Explained | null;
  fixes: Fix[];
  preview: { fix: Fix; row: VariantAudit; worst: Explained | null } | null;
  query: string;
}

export interface PromotionCheck {
  leaks: { id: string; title: string; outcome: Outcome }[];
  newlyUnknown: { id: string; title: string; reasons: UnknownReason[] }[];
  checked: number;
}

/** How a change was saved: written to Shopify first (with the discount's Shopify ID after), or only here. */
export interface SaveOptions {
  action?: HistoryAction;
  where?: 'shopify' | 'local';
  gid?: string | null;
}

export interface CalendarSegment {
  start: number;
  end: number;
  active: string[];
  leaks: { id: string; title: string; loss: number; stack: string[] }[];
  unknown: number;
}

export interface Calendar {
  start: number;
  end: number;
  discounts: { id: string; title: string; class: Discount['class']; method: Discount['method']; starts: number | null; ends: number | null; supported: boolean }[];
  segments: CalendarSegment[];
  /** Set when there were more distinct sets of live discounts than were audited. */
  truncated: boolean;
}

export interface RollbackPlan {
  kind: 'create' | 'update' | 'delete';
  discount: Discount;
  current: Discount | null;
}

const CALENDAR_SETS = 40;
const BACKUP_FORMAT = 'discount-audit';

export class Workspace {
  private persistence: Persistence;
  private now: () => number;
  private store!: StoreInput;
  private app!: AppState;
  private result!: AuditResult;
  private asOf = 0;
  private full: AuditResult | null = null;
  private previous: { store: StoreInput; app: AppState } | null = null;

  constructor(persistence: Persistence, now: () => number = Date.now) {
    this.persistence = persistence;
    this.now = now;
    if (!persistence.active()) {
      persistence.replace((db) => {
        loadStore(db, SAMPLE_STORE);
        db.query(Q.WRITE_APP, { json: JSON.stringify(defaultState(true)) });
      });
    }
    this.refresh();
  }

  private get db(): Driver {
    return this.persistence.active()!;
  }

  private scenario(settings: Settings = this.app.settings): Scenario {
    const { shippingCost, maxQty, floorBps } = settings;
    return { shippingCost, maxQty, floorBps, asOf: this.asOf };
  }

  private refresh(): void {
    this.store = readStore(this.db);
    const saved = this.db.query<{ json: string }>(Q.READ_APP)[0];
    // A store built by `demo:build` has no app node.
    this.app = saved ? checkState(JSON.parse(saved.json)) : defaultState(true);
    this.asOf = this.now();
    this.full = null;
    this.result = audit(this.db, this.scenario());
  }

  private fullAudit(): AuditResult {
    this.full ??= audit(this.db, this.scenario(), { collectLeaks: true });
    return this.full;
  }

  private commit(store: StoreInput, app: AppState): Snapshot {
    validate(store);
    const previous = { store: this.store, app: this.app };
    this.persistence.replace((db) => {
      loadStore(db, store);
      db.query(Q.WRITE_APP, { json: JSON.stringify(app) });
    });
    this.previous = previous;
    this.refresh();
    return this.snapshot();
  }

  private saveApp(app: AppState): Snapshot {
    this.db.query(Q.WRITE_APP, { json: JSON.stringify(app) });
    this.previous = null;
    this.refresh();
    return this.snapshot();
  }

  private explain(db: Driver, outcome: Outcome | null, price: number, discounts = this.store.discounts): Explained | null {
    if (!outcome) return null;
    const stack = outcome.stack.map((id) => discounts.find((d) => d.id === id)!);
    return {
      outcome,
      lines: breakdown(stack, price, outcome.qty, this.app.settings.shippingCost),
      pairs: outcome.stack.length > 1 ? explainStack(db, outcome.stack) : [],
    };
  }

  snapshot(): Snapshot {
    return { store: this.store, app: this.app, audit: this.result, saved: this.persistence.saved, canUndo: !!this.previous };
  }

  product(id: string, fixId?: string): ProductDetail {
    const row = this.result.variants.find((v) => v.id === id);
    if (!row) throw new InputError([`There is no product with the ID “${id}”`]);

    const fixes = row.state === 'leak' ? suggestFixes(this.db, this.store, this.fullAudit(), id) : [];
    let preview: ProductDetail['preview'] = null;
    if (fixId) {
      const fix = fixes.find((f) => f.id === fixId);
      if (!fix) throw new InputError(['That fix no longer applies. Choose another one']);
      const after = audit(this.db, { ...this.scenario(), removed: fix.removed, disabled: fix.disabled });
      const changed = after.variants.find((v) => v.id === id)!;
      preview = { fix, row: changed, worst: this.explain(this.db, changed.worst, row.price) };
    }
    return { row, worst: this.explain(this.db, row.worst, row.price), fixes, preview, query: Q.EXTEND_GROUPS };
  }

  parsePromotion(text: string): PromotionParse {
    return parsePromotion(text, this.store);
  }

  /** Builds the store plus the promotion in a scratch graph. The saved graph is never touched. */
  checkPromotion(discount: Discount): PromotionCheck {
    if (this.store.discounts.some((d) => d.id === discount.id)) {
      throw new InputError([`${discount.id} is already a discount. Use a different code`]);
    }
    return this.checkDiscount(discount);
  }

  /**
   * The guard before a save: which products this discount, as edited, would help sell below cost.
   * Runs in a scratch graph; the saved graph is never touched.
   */
  checkDiscount(discount: Discount, originalId?: string): PromotionCheck {
    const others = this.store.discounts.filter((d) => d.id !== originalId);
    if (others.some((d) => d.id === discount.id)) throw new InputError([`${discount.id} is already a discount. Use a different code`]);
    const draft = { ...this.store, discounts: [...others, discount] };
    validate(draft);
    const db = this.persistence.scratch();
    loadStore(db, draft);
    const after = audit(db, this.scenario(), { focus: discount.id });
    const before = new Map(this.result.variants.map((v) => [v.id, v]));

    return {
      checked: after.variants.length,
      leaks: after.variants
        .flatMap((v) => (v.focus ? [{ id: v.id, title: v.title, outcome: v.focus }] : []))
        .sort((a, b) => a.outcome.net - a.outcome.cost - (b.outcome.net - b.outcome.cost)),
      newlyUnknown: after.variants
        .filter((v) => v.unknown.some((reason) => !before.get(v.id)?.unknown.includes(reason)))
        .map((v) => ({ id: v.id, title: v.title, reasons: v.unknown })),
    };
  }

  private recorded(app: AppState, entries: Omit<HistoryEntry, 'id' | 'at' | 'rolledBack'>[], link?: ShopifyLink | null): AppState {
    const at = this.now();
    const made = entries.map((e, i) => ({ ...e, id: `${at.toString(36)}-${(app.history.length + i).toString(36)}`, at, rolledBack: false }));
    return { ...app, history: [...app.history, ...made].slice(-HISTORY_LIMIT), shopify: link === undefined ? app.shopify : link };
  }

  /** The Shopify ID map after a discount was saved, renamed or deleted. `gid` undefined means unchanged. */
  private relinked(oldId: string | null, newId: string | null, gid: string | null | undefined): ShopifyLink | null {
    const link = this.app.shopify;
    if (!link || gid === undefined) return link;
    const discounts = { ...link.discounts };
    if (oldId) delete discounts[oldId];
    if (newId && gid) discounts[newId] = gid;
    return { ...link, discounts };
  }

  saveDiscount(discount: Discount, originalId?: string, options: SaveOptions = {}): Snapshot {
    const { discounts } = this.store;
    if (discount.id !== originalId && discounts.some((d) => d.id === discount.id)) {
      throw new InputError([`${discount.id} is already a discount. Use a different code`]);
    }
    const before = originalId ? discounts.find((d) => d.id === originalId) ?? null : null;
    if (originalId && !before) throw new InputError([`${originalId} is no longer in this audit`]);
    const next = originalId ? discounts.map((d) => (d.id === originalId ? discount : d)) : [...discounts, discount];
    const app = this.recorded(
      this.app,
      [{ action: options.action ?? (before ? 'update' : 'create'), discount: discount.id, before, after: discount, where: options.where ?? 'local' }],
      this.relinked(originalId ?? null, discount.id, options.gid),
    );
    return this.commit({ ...this.store, discounts: next }, app);
  }

  deleteDiscount(id: string, options: SaveOptions = {}): Snapshot {
    const before = this.store.discounts.find((d) => d.id === id);
    if (!before) throw new InputError([`${id} is no longer in this audit`]);
    const link = this.relinked(id, null, options.where === 'shopify' ? null : undefined);
    const app = this.recorded(this.app, [{ action: 'delete', discount: id, before, after: null, where: options.where ?? 'local' }], link);
    return this.commit({ ...this.store, discounts: this.store.discounts.filter((d) => d.id !== id) }, app);
  }

  /** What undoing a history entry means for the discount as it is now. */
  rollbackPlan(entryId: string): RollbackPlan {
    const entry = this.app.history.find((e) => e.id === entryId);
    if (!entry) throw new InputError(['That change is no longer in the history']);
    if (entry.rolledBack) throw new InputError(['That change was already rolled back']);
    const currentId = entry.after?.id ?? entry.discount;
    const current = this.store.discounts.find((d) => d.id === currentId) ?? null;
    if (entry.after && (!current || JSON.stringify(current) !== JSON.stringify(entry.after))) {
      throw new InputError([`${currentId} was changed again since, so roll back the later change first`]);
    }
    if (!entry.before) return { kind: 'delete', discount: current!, current };
    if (!current) {
      if (this.store.discounts.some((d) => d.id === entry.before!.id)) throw new InputError([`${entry.before.id} already exists, so this can’t be restored`]);
      return { kind: 'create', discount: entry.before, current: null };
    }
    return { kind: 'update', discount: entry.before, current };
  }

  /** Puts the discount back the way it was before a change. When connected, write to Shopify first. */
  rollback(entryId: string, options: SaveOptions = {}): Snapshot {
    const plan = this.rollbackPlan(entryId);
    const where = options.where ?? 'local';
    const discounts =
      plan.kind === 'delete'
        ? this.store.discounts.filter((d) => d.id !== plan.current!.id)
        : plan.kind === 'create'
          ? [...this.store.discounts, plan.discount]
          : this.store.discounts.map((d) => (d.id === plan.current!.id ? plan.discount : d));
    const marked = { ...this.app, history: this.app.history.map((e) => (e.id === entryId ? { ...e, rolledBack: true } : e)) };
    const gid = where === 'shopify' && plan.kind === 'delete' ? null : options.gid;
    const link = this.relinked(plan.current?.id ?? null, plan.kind === 'delete' ? null : plan.discount.id, gid);
    const entry = { action: 'rollback' as const, discount: plan.discount.id, before: plan.current, after: plan.kind === 'delete' ? null : plan.discount, where };
    return this.commit({ ...this.store, discounts }, this.recorded(marked, [entry], link));
  }

  /**
   * The next weeks, stretch by stretch: which discounts are live, and which products lose money then.
   * Each distinct set of live discounts is audited once, with the others disabled.
   */
  calendar(days = 42): Calendar {
    if (!Number.isSafeInteger(days) || days < 1 || days > 120) throw new InputError(['Show from 1 to 120 days']);
    const today = new Date(this.now());
    today.setHours(0, 0, 0, 0);
    const start = today.getTime();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days).getTime();
    const ds = this.store.discounts;
    const cuts = new Set([start, end]);
    for (const d of ds) for (const t of [d.starts, d.ends]) if (t !== null && t > start && t < end) cuts.add(t);
    const points = [...cuts].sort((a, b) => a - b);

    const cache = new Map<string, Omit<CalendarSegment, 'start' | 'end' | 'active'>>();
    let truncated = false;
    const segments: CalendarSegment[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const at = points[i];
      const active = ds.filter((d) => (d.starts === null || d.starts <= at) && (d.ends === null || d.ends > at)).map((d) => d.id);
      const key = active.join('|');
      let found = cache.get(key);
      if (!found) {
        if (cache.size >= CALENDAR_SETS) {
          truncated = true;
          break;
        }
        const live = new Set(active);
        const result = audit(this.db, { ...this.scenario(), asOf: undefined, disabled: ds.filter((d) => !live.has(d.id)).map((d) => d.id) });
        found = {
          leaks: result.variants
            .filter((v) => v.state === 'leak')
            .map((v) => ({ id: v.id, title: v.title, loss: v.worst!.cost - v.worst!.net, stack: v.worst!.stack }))
            .sort((a, b) => b.loss - a.loss),
          unknown: result.counts.unknown,
        };
        cache.set(key, found);
      }
      segments.push({ start: at, end: points[i + 1], active, ...found });
    }
    return {
      start,
      end,
      discounts: ds.map(({ id, title, class: cls, method, starts, ends, supported }) => ({ id, title, class: cls, method, starts, ends, supported })),
      segments,
      truncated,
    };
  }

  setCost(id: string, cost: number | null): Snapshot {
    const variants = this.store.variants.map((v) => (v.id === id ? { ...v, cost } : v));
    return this.commit({ ...this.store, variants }, this.app);
  }

  saveSettings(settings: Settings, plus: boolean): Snapshot {
    checkSettings(settings);
    const app = { ...this.app, settings: { ...settings, storeName: settings.storeName.trim() } };
    // Plus changes which pairs can combine, so the edges have to be derived again.
    return plus === this.store.plus ? this.saveApp(app) : this.commit({ ...this.store, plus }, app);
  }

  addToChecklist(changes: Change[], product: string): Snapshot {
    const id = changeId(changes);
    const existing = this.app.checklist.find((item) => item.id === id && !item.done);
    const products = [...new Set([...(existing?.products ?? []), product])];
    const checklist = [...this.app.checklist.filter((item) => item.id !== id), { id, changes, products, done: false }];
    return this.saveApp({ ...this.app, checklist });
  }

  removeFromChecklist(id: string): Snapshot {
    return this.saveApp({ ...this.app, checklist: this.app.checklist.filter((item) => item.id !== id) });
  }

  /** The merchant made the change in Shopify, so this copy of the settings follows. */
  completeChecklistItem(id: string, options: SaveOptions = {}): Snapshot {
    const item = this.app.checklist.find((i) => i.id === id && !i.done);
    if (!item) throw new InputError(['That checklist item is already done']);
    const checklist = this.app.checklist.map((i) => (i === item ? { ...i, done: true } : i));
    const next = applyChanges(this.store, item.changes, this.now());
    const changed = next.discounts.flatMap((after) => {
      const before = this.store.discounts.find((d) => d.id === after.id)!;
      return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ action: 'fix' as const, discount: after.id, before, after, where: options.where ?? 'local' }];
    });
    return this.commit(next, this.recorded({ ...this.app, checklist }, changed));
  }

  readCsv(files: { products: string; discounts: string }, plus: boolean) {
    const store = importCsv(files, plus);
    return { store, missingCost: store.variants.filter((v) => v.cost === null).length };
  }

  useImport(store: StoreInput, storeName: string, currency?: Currency | null, shopify?: ShopifyLink | null): Snapshot {
    const settings = { ...this.app.settings, storeName: storeName.trim(), ...(currency ? { currency } : {}) };
    checkSettings(settings);
    const link = shopify ? checkState({ ...defaultState(false), shopify }).shopify : null;
    return this.commit(store, { settings, checklist: [], sample: false, history: [], shopify: link });
  }

  /** New data from Shopify for the same store: keeps settings, checklist and history. */
  refreshFromShopify(store: StoreInput, shopify: ShopifyLink): Snapshot {
    if (!this.app.shopify || this.app.shopify.shop !== shopify.shop) throw new InputError(['This is a different store. Use Import to replace the audit']);
    const link = checkState({ ...defaultState(false), shopify }).shopify;
    return this.commit(store, { ...this.app, shopify: link });
  }

  resetSample(): Snapshot {
    return this.commit(SAMPLE_STORE, defaultState(true));
  }

  undo(): Snapshot {
    if (!this.previous) throw new InputError(['There is nothing to undo']);
    const { store, app } = this.previous;
    const snapshot = this.commit(store, app);
    this.previous = null;
    return { ...snapshot, canUndo: false };
  }

  backup(): string {
    return JSON.stringify({ format: BACKUP_FORMAT, version: 1, store: this.store, app: this.app }, null, 2);
  }

  restore(text: string): Snapshot {
    const { store, app } = readBackup(text);
    return this.commit(store, app);
  }

  report(): string {
    const full = this.fullAudit();
    const details = new Map<string, { fix?: Fix; pairs: PairRule[] }>();
    for (const v of this.result.variants) {
      if (v.state !== 'leak') continue;
      details.set(v.id, {
        fix: suggestFixes(this.db, this.store, full, v.id)[0],
        pairs: explainStack(this.db, v.worst?.stack ?? []),
      });
    }
    return buildReport({ productName: PRODUCT_NAME, app: this.app, audit: this.result, details, now: this.now() });
  }
}

export function readBackup(text: string): { store: StoreInput; app: AppState } {
  let data: { format?: string; version?: number; store?: StoreInput; app?: unknown };
  try {
    data = JSON.parse(text);
  } catch {
    throw new InputError(['This file isn’t a backup. Choose the .json file you downloaded with Back up']);
  }
  if (data?.format !== BACKUP_FORMAT || data.version !== 1 || !data.store) {
    throw new InputError(['This file isn’t a backup this version can read']);
  }
  validate(data.store);
  return { store: data.store, app: checkState(data.app) };
}
