# StackLeak

Find the discount stack that sells below cost, before your customers do. (Working name.)

> Early build. The engine works. The app screens are designed but not built yet.

## Use case

Each promotion in a store can be profitable alone. A 20% product discount, a 15% welcome code and free shipping together turn a $100 jacket that costs $65 into a $60 sale. StackLeak is for merchants and agencies who need to find those stacks before a sale goes live.

The relationships that matter are which discounts reach which products, and which pairs of discounts allow each other. A stack is possible only when **every** pair in it combines, which makes this a search for fully connected groups.

## How it uses Relate

- **Mode:** directory.
- **Why this mode:** one app writes while agents read. On Windows a single `.rl` file could not be read by a second process during writes.
- **What the graph models:**

```text
(Variant)-[:IN]->(Collection)
(Discount)-[:APPLIES_TO]->(Variant | Collection)
(Discount)-[:ALLOWS]->(Class)
(Discount)-[:HAS_TAG | ACCEPTS_TAG]->(Tag)
(Discount)-[:COMBINES_WITH {key, rule}]->(Discount)
```

Relate derives each `COMBINES_WITH` edge from the rules, finds every fully connected group by intersecting neighbors, and returns the rule behind each pair. Money is then calculated with exact integers. All Cypher is in [queries.ts](packages/core/src/queries.ts).

The same core runs on Relate native and Relate WASM.

## Setup and run

Requires Node 22.16 or later. Native Relate on Linux also needs glibc 2.39 or later (Ubuntu 24.04, Debian 13).

```bash
npm ci
npm run demo:audit    # audit the committed store
npm test              # both engines, an independent evaluator, clone tests
npm run typecheck
```

## Where the data lives

[`demo/store`](demo/store) is a persistent Relate directory store with 50 synthetic variants and 12 discounts. `.gitattributes` marks it binary, because Relate cannot open it if Git rewrites its line endings. To rebuild it, move the folder away and run `npm run demo:build`.

## Limits

- The rules follow Shopify's developer documentation and one vendor guide. They are **not yet verified against a real checkout**.
- One product per cart. Taxes, payment fees, markets, segments, Functions and Buy X Get Y are not modeled. Unsupported discounts make a product Unknown.
- Searches stop at eight discounts in a stack and report Unknown beyond that.

## Built with AI

Design, code, tests and documentation were written with significant help from Claude (Claude Code), including a separately written reference evaluator for differential testing.

## License

Code is [MIT](LICENSE). Images in `docs/design/inspiration` are third-party references and are not covered by that license.

StackLeak is not affiliated with or endorsed by Neo4j or Shopify.
