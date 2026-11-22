import { audit, explainStack } from './audit.ts';
import { checkSettings, checkState, defaultState, type AppState, type Settings } from './app-state.ts';
import { importCsv } from './csv.ts';
import { applyChanges, changeId, suggestFixes, type Change, type Fix } from './fixes.ts';
import { breakdown, type ReceiptLine } from './money.ts';
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
    const draft = { ...this.store, discounts: [...this.store.discounts, discount] };
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
        .filter((v) => v.unknown.some((reason) => !before.get(v.id)!.unknown.includes(reason)))
        .map((v) => ({ id: v.id, title: v.title, reasons: v.unknown })),
    };
  }

  saveDiscount(discount: Discount, originalId?: string): Snapshot {
    const { discounts } = this.store;
    if (discount.id !== originalId && discounts.some((d) => d.id === discount.id)) {
      throw new InputError([`${discount.id} is already a discount. Use a different code`]);
    }
    const next = originalId ? discounts.map((d) => (d.id === originalId ? discount : d)) : [...discounts, discount];
    return this.commit({ ...this.store, discounts: next }, this.app);
  }

  deleteDiscount(id: string): Snapshot {
    return this.commit({ ...this.store, discounts: this.store.discounts.filter((d) => d.id !== id) }, this.app);
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
  completeChecklistItem(id: string): Snapshot {
    const item = this.app.checklist.find((i) => i.id === id && !i.done);
    if (!item) throw new InputError(['That checklist item is already done']);
    const checklist = this.app.checklist.map((i) => (i === item ? { ...i, done: true } : i));
    return this.commit(applyChanges(this.store, item.changes, this.now()), { ...this.app, checklist });
  }

  readCsv(files: { products: string; discounts: string }, plus: boolean) {
    const store = importCsv(files, plus);
    return { store, missingCost: store.variants.filter((v) => v.cost === null).length };
  }

  useImport(store: StoreInput, storeName: string): Snapshot {
    const settings = { ...this.app.settings, storeName: storeName.trim() };
    checkSettings(settings);
    return this.commit(store, { settings, checklist: [], sample: false });
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
