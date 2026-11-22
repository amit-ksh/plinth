import { netRevenue, type Priced } from './money.ts';
import * as Q from './queries.ts';
import type { AuditResult, Driver, PairRule, Scenario, UnknownReason, Variant, VariantAudit } from './types.ts';

export const MAX_STACK = 8;
export const MAX_CODES = 5;
/** Beyond this the affected variants become Unknown. They never become Clear. */
export const MAX_GROUPS_PER_PROFILE = 25_000;
const BATCH = 2_000;

interface DiscountRow extends Priced {
  id: string;
  method: 'code' | 'automatic';
  allVariants: boolean;
  supported: boolean;
}

interface Profile {
  allowed: string[];
  groups: string[][];
  incomplete: boolean;
}

const usesCode = (d: DiscountRow) => d.method === 'code' && d.class !== 'shipping';

function checkScenario(s: Scenario): void {
  if (!Number.isSafeInteger(s.shippingCost) || s.shippingCost < 0) {
    throw new RangeError('shippingCost must be a whole number of minor units, 0 or more');
  }
  if (!Number.isSafeInteger(s.maxQty) || s.maxQty < 1 || s.maxQty > 100) {
    throw new RangeError('maxQty must be a whole number from 1 to 100');
  }
  if (s.floorBps !== undefined && (!Number.isSafeInteger(s.floorBps) || s.floorBps < 0 || s.floorBps >= 10000)) {
    throw new RangeError('floorBps must be a whole number from 0 to 9999');
  }
}

function findGroups(db: Driver, profiles: Profile[], byId: Map<string, DiscountRow>, removed: string[]): void {
  const allowed = profiles.map((p) => p.allowed);
  let frontier: { profile: number; members: string[] }[] = [];
  profiles.forEach((p, profile) => {
    for (const id of p.allowed) {
      p.groups.push([id]);
      frontier.push({ profile, members: [id] });
    }
  });

  // One round past the limit, to learn whether anything was left out.
  for (let size = 2; size <= MAX_STACK + 1 && frontier.length; size++) {
    const next: typeof frontier = [];
    for (let i = 0; i < frontier.length; i += BATCH) {
      const groups = frontier.slice(i, i + BATCH).filter((g) => !profiles[g.profile].incomplete);
      if (!groups.length) continue;
      const rows = db.query<{ profile: number; members: string[] }>(Q.EXTEND_GROUPS, { groups, profiles: allowed, removed });
      for (const { profile, members } of rows) {
        // Adding a discount never lowers the code count, so pruning here is safe.
        if (members.filter((id) => usesCode(byId.get(id)!)).length > MAX_CODES) continue;
        const p = profiles[profile];
        if (size > MAX_STACK || p.groups.length >= MAX_GROUPS_PER_PROFILE) {
          p.incomplete = true;
          continue;
        }
        p.groups.push(members);
        next.push({ profile, members });
      }
    }
    frontier = next;
  }

  // Engines may return rows in different orders. Sorting keeps ties and output identical.
  for (const p of profiles) {
    p.groups = p.groups
      .map((group) => ({ group, key: group.join('|') }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map(({ group }) => group);
  }
}

export function audit(db: Driver, scenario: Scenario, options: { collectLeaks?: boolean; focus?: string } = {}): AuditResult {
  checkScenario(scenario);
  const { shippingCost, maxQty, floorBps = 0, asOf = null, removed = [], disabled = [] } = scenario;

  const variants = db.query<Omit<Variant, 'collections'>>(Q.VARIANTS);
  const discounts = db.query<DiscountRow>(Q.DISCOUNTS, { disabled, as_of: asOf });
  const byId = new Map(discounts.map((d) => [d.id, d]));
  const everywhere = discounts.filter((d) => d.allVariants).map((d) => d.id);

  const scope = new Map(variants.map((v) => [v.id, new Set(everywhere)]));
  for (const { variant, discount } of db.query<{ variant: string; discount: string }>(Q.SCOPE)) {
    if (byId.has(discount)) scope.get(variant)?.add(discount);
  }

  // Variants reached by the same discounts share one search.
  const profiles: Profile[] = [];
  const profileIndex = new Map<string, number>();
  const placed = variants.map((variant) => {
    const reach = [...scope.get(variant.id)!].sort();
    const allowed = reach.filter((id) => byId.get(id)!.supported);
    const key = allowed.join('|');
    let index = profileIndex.get(key);
    if (index === undefined) {
      index = profiles.length;
      profileIndex.set(key, index);
      profiles.push({ allowed, groups: [], incomplete: false });
    }
    return { variant, index, profile: profiles[index], unsupported: allowed.length !== reach.length };
  });

  findGroups(db, profiles, byId, removed);

  // Variants with the same reach and price share one set of net amounts.
  const stacks = profiles.map((p) => p.groups.map((group) => group.map((id) => byId.get(id)!)));
  const netCache = new Map<string, (number | null)[]>();
  const netsFor = (index: number, price: number, qty: number) => {
    const key = `${index}:${price}:${qty}`;
    let nets = netCache.get(key);
    if (!nets) {
      nets = stacks[index].map((stack) => netRevenue(stack, price, qty, shippingCost));
      netCache.set(key, nets);
    }
    return nets;
  };

  const result: AuditResult = {
    variants: [],
    counts: { leak: 0, thin: 0, unknown: 0, clear_in_model: 0 },
    groupsSearched: profiles.reduce((total, p) => total + p.groups.length, 0),
  };

  for (const { variant, index, profile, unsupported } of placed) {
    const cost = variant.cost ?? null;
    const unknown: UnknownReason[] = [];
    if (cost === null) unknown.push('missing_cost');
    if (unsupported) unknown.push('unsupported_discount');
    if (profile.incomplete) unknown.push('search_incomplete');

    const row: VariantAudit = {
      id: variant.id,
      title: variant.title,
      price: variant.price,
      cost,
      state: 'clear_in_model',
      worst: null,
      leakCount: 0,
      leaks: [],
      focus: null,
      unknown,
    };
    let thin = false;

    if (cost !== null) {
      const consider = (stack: string[], qty: number, net: number) => {
        const total = cost * qty;
        const margin = net - total;
        const worst = row.worst;
        // Margin per unit, cross-multiplied to stay in integers.
        if (!worst || margin * worst.qty < (worst.net - worst.cost) * qty) {
          row.worst = { qty, stack: [...stack], net, cost: total };
        }
        if (margin < 0) {
          row.leakCount++;
          if (options.collectLeaks) row.leaks.push({ qty, stack: [...stack], net, cost: total });
          if (options.focus && stack.includes(options.focus)) {
            const worstWith = row.focus;
            if (!worstWith || margin * worstWith.qty < (worstWith.net - worstWith.cost) * qty) {
              row.focus = { qty, stack: [...stack], net, cost: total };
            }
          }
        } else if (floorBps > 0 && margin * 10000 < floorBps * net) {
          thin = true;
        }
      };

      consider([], 1, variant.price); // below cost with no discount at all
      for (let qty = 1; qty <= maxQty; qty++) {
        const nets = netsFor(index, variant.price, qty);
        for (let i = 0; i < nets.length; i++) {
          const net = nets[i];
          if (net !== null) consider(profile.groups[i], qty, net);
        }
      }
    }

    // A proven leak outranks Unknown. Unknown outranks every reassuring state.
    row.state = row.leakCount ? 'leak' : unknown.length ? 'unknown' : thin ? 'thin' : 'clear_in_model';
    result.counts[row.state]++;
    result.variants.push(row);
  }

  if (options.collectLeaks) {
    result.groups = [...new Map(profiles.flatMap((p) => p.groups).map((g) => [g.join('|'), g])).values()];
  }
  return result;
}

export function explainStack(db: Driver, stack: string[]): PairRule[] {
  return db.query<PairRule>(Q.EXPLAIN_STACK, { stack });
}
