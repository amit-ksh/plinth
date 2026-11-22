// Every Cypher statement in the product lives here, so "Show query" can display exactly what ran.

export const IS_EMPTY = `MATCH (n) RETURN count(n) AS n`;

export const INDEXES = ['Variant', 'Collection', 'Discount', 'Tag', 'Class'].map(
  (label) => `CREATE INDEX FOR (n:${label}) ON (n.id)`,
);

export const CREATE_STORE = `CREATE (:Store {id: 'store', plus: $plus})`;
export const CREATE_CLASSES = `UNWIND ['product', 'order', 'shipping'] AS id CREATE (:Class {id: id})`;
export const CREATE_COLLECTIONS = `UNWIND $rows AS r CREATE (:Collection {id: r.id, title: r.title})`;
export const CREATE_VARIANTS = `UNWIND $rows AS r
CREATE (v:Variant {id: r.id, title: r.title, price: r.price})
SET v.cost = r.cost`;
export const CREATE_DISCOUNTS = `UNWIND $rows AS r
CREATE (d:Discount {id: r.id, title: r.title, class: r.class, method: r.method, bps: r.bps, off: r.off,
  all_variants: r.allVariants, min_subtotal: r.minSubtotal, supported: r.supported})
SET d.starts = r.starts, d.ends = r.ends`;
export const CREATE_TAGS = `UNWIND $rows AS id CREATE (:Tag {id: id})`;

const link = (from: string, type: string, to: string) => `UNWIND $rows AS r
MATCH (a:${from} {id: r.from}), (b:${to} {id: r.to})
CREATE (a)-[:${type}]->(b)`;

export const LINK_IN = link('Variant', 'IN', 'Collection');
export const LINK_VARIANT = link('Discount', 'APPLIES_TO', 'Variant');
export const LINK_COLLECTION = link('Discount', 'APPLIES_TO', 'Collection');
export const LINK_ALLOWS = link('Discount', 'ALLOWS', 'Class');
export const LINK_HAS_TAG = link('Discount', 'HAS_TAG', 'Tag');
export const LINK_ACCEPTS_TAG = link('Discount', 'ACCEPTS_TAG', 'Tag');

/** The combination rules. An edge exists only when both sides agree, and it records why. */
export const DERIVE_PAIRS = `MATCH (s:Store {id: 'store'})
MATCH (a:Discount {supported: true}), (b:Discount {supported: true})
WHERE a.id < b.id
  AND NOT (a.class = 'shipping' AND b.class = 'shipping')
  AND (a.starts IS NULL OR b.ends IS NULL OR a.starts < b.ends)
  AND (b.starts IS NULL OR a.ends IS NULL OR b.starts < a.ends)
  AND EXISTS { MATCH (a)-[:ALLOWS]->(k:Class) WHERE k.id = b.class }
  AND EXISTS { MATCH (b)-[:ALLOWS]->(k:Class) WHERE k.id = a.class }
  AND (NOT (a.class = 'product' AND b.class = 'product') OR (
    s.plus
    AND EXISTS { MATCH (a)-[:ACCEPTS_TAG]->(:Tag)<-[:HAS_TAG]-(b) }
    AND EXISTS { MATCH (b)-[:ACCEPTS_TAG]->(:Tag)<-[:HAS_TAG]-(a) }
  ))
CREATE (a)-[:COMBINES_WITH {
  key: a.id + '|' + b.id,
  rule: CASE WHEN a.class = 'product' AND b.class = 'product'
    THEN 'Each product discount accepts a tag on the other'
    ELSE 'Both discounts allow the other class: ' + a.class + ' and ' + b.class END
}]->(b)`;

export const VARIANTS = `MATCH (v:Variant)
RETURN v.id AS id, v.title AS title, v.price AS price, v.cost AS cost
ORDER BY id`;

export const DISCOUNTS = `MATCH (d:Discount)
WHERE NOT d.id IN $disabled AND ($as_of IS NULL OR d.ends IS NULL OR d.ends > $as_of)
RETURN d.id AS id, d.class AS class, d.method AS method, d.bps AS bps, d.off AS off,
  d.all_variants AS allVariants, d.min_subtotal AS minSubtotal, d.supported AS supported
ORDER BY id`;

/** Which discounts reach a variant, directly or through a collection. */
export const SCOPE = `MATCH (v:Variant)-[:IN*0..1]->()<-[:APPLIES_TO]-(d:Discount)
RETURN DISTINCT v.id AS variant, d.id AS discount`;

/**
 * Grows fully connected groups by one discount, which must be a common neighbor of every member.
 * Edges run from lower to higher ID, so each group appears exactly once.
 * $profiles holds, for each distinct reach, the discounts that can be used there.
 */
export const EXTEND_GROUPS = `UNWIND $groups AS row
UNWIND row.members AS member
MATCH (:Discount {id: member})-[c:COMBINES_WITH]->(next:Discount)
WHERE NOT c.key IN $removed AND next.id IN $profiles[row.profile]
WITH row.profile AS profile, row.members AS members, next.id AS added, count(c) AS linked
WHERE linked = size(members)
RETURN profile, members + [added] AS members`;

export const EXPLAIN_STACK = `MATCH (a:Discount)-[c:COMBINES_WITH]->(b:Discount)
WHERE a.id IN $stack AND b.id IN $stack
RETURN c.key AS key, a.id AS left, b.id AS right, c.rule AS rule
ORDER BY key`;
