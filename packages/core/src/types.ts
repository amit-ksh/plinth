export type DiscountClass = 'product' | 'order' | 'shipping';
export type State = 'leak' | 'thin' | 'unknown' | 'clear_in_model';
export type UnknownReason = 'missing_cost' | 'unsupported_discount' | 'search_incomplete';

/** Money is always integer minor units. Percentages are basis points. Instants are epoch milliseconds. */
export interface Variant {
  id: string;
  title: string;
  price: number;
  cost: number | null;
  collections: string[];
}

export interface Discount {
  id: string;
  title: string;
  class: DiscountClass;
  method: 'code' | 'automatic';
  bps: number;
  off: number;
  allVariants: boolean;
  variants: string[];
  collections: string[];
  minSubtotal: number;
  combinesWith: DiscountClass[];
  tags: string[];
  acceptsTags: string[];
  starts: number | null;
  ends: number | null;
  supported: boolean;
}

export interface StoreInput {
  /** Same-line product stacking needs Shopify Plus. */
  plus: boolean;
  collections: { id: string; title: string }[];
  variants: Variant[];
  discounts: Discount[];
}

export interface Scenario {
  shippingCost: number;
  maxQty: number;
  floorBps?: number;
  /** Discounts that ended at or before this instant are left out. */
  asOf?: number;
  removed?: string[];
  disabled?: string[];
}

export interface Outcome {
  qty: number;
  stack: string[];
  net: number;
  cost: number;
}

export interface VariantAudit {
  id: string;
  title: string;
  price: number;
  cost: number | null;
  state: State;
  /** Lowest margin per unit, then lowest quantity. An empty stack means list price. */
  worst: Outcome | null;
  leakCount: number;
  /** Filled only when `collectLeaks` is set. */
  leaks: Outcome[];
  unknown: UnknownReason[];
}

export interface AuditResult {
  variants: VariantAudit[];
  counts: Record<State, number>;
  groupsSearched: number;
}

export interface PairRule {
  key: string;
  left: string;
  right: string;
  rule: string;
}

/** The only thing the engine needs from Relate. Native and WASM each implement it. */
export interface Driver {
  query<T = Record<string, unknown>>(cypher: string, params?: Record<string, unknown>): T[];
  transaction<T>(work: () => T): T;
}
