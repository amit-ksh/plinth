# 02 Feature specs

## Users and jobs

| User | Job | Success |
|---|---|---|
| Agency (primary) | Audit a client's promotions before launch | Report in under 10 minutes |
| Merchant | Know the worst stack and how to close it | One setting to change, with its side effects |
| AI agent | Check a planned promotion | Structured answer over MCP |
| Judge | Understand it quickly | Leak and fix within 60 seconds, no account |

## Summary

| ID | Feature | Priority | Sprint |
|---|---|---|---|
| S01 | Sample and committed store | P0 | 1 |
| S02 | Versioned combination rules | P0 | 1 |
| S03 | Leak engine | P0 | 1 |
| S04 | Audit board | P0 | 2 |
| S05 | Proof: pairs and arithmetic | P0 | 2 |
| S06 | Fix simulator | P0 | 2 |
| S07 | Persistence and backup | P0 | 2 |
| S08 | Import | P0 | 3 |
| S09 | Windows desktop app | P0 | 3 |
| S10 | Read-only MCP | P0 | 3 |
| S11 | Client HTML report | P1 | 4 |
| S12 | Draft-promotion check | P1 | 4 |
| S13 | Margin floor (Thin) | P1 | 4 |
| S14 | Shopify OAuth sync | P2 | Later |
| S15 | Admin browser extension | P2 | Later |
| S16 | Buy X Get Y, segments, markets, mixed carts | P2 | Later |
| S17 | Scheduled monitoring and alerts | P2 | Later |

## P0

### S01 Sample and committed store
- [ ] 50 synthetic variants, 5 collections, 12 discounts.
- [ ] Jacket: $100 price, $65 cost, three-discount leak netting $60.
- [ ] Boots: $100 price, $62 cost, tag-based leak netting $60.
- [ ] A connected but not fully compatible trio is never reported.
- [ ] One variant without cost shows Unknown.
- [ ] The store opens after a clone with `core.autocrlf` true, false and input.

### S02 Combination rules
- [ ] Both discounts must allow the other's class.
- [ ] Product pairs need a two-way tag match and the store's Plus setting.
- [ ] Shipping pairs never combine.
- [ ] Non-overlapping dates never combine.
- [ ] Every derived edge names the rule that created it.
- [ ] Rules D4-D10 are confirmed on a development store or labeled Assumed in the UI.

### S03 Leak engine
- [ ] Finds groups from one to eight discounts in which every pair combines.
- [ ] Respects scope, thresholds and code limits.
- [ ] Shows the worst result per variant and lets others expand.
- [ ] Reports incomplete searches and unsupported discounts.
- [ ] Native and WASM results are identical on all fixtures.

### S04 Audit board
- [ ] Opens on the sample with counts for Leak, Unknown and Clear in model.
- [ ] Ranks by loss per order.
- [ ] Never sums losses as "money lost", because order volume is unknown.
- [ ] States use text and icon as well as color.

### S05 Proof
- [ ] Draws the group with every pair and its rule.
- [ ] Shows each arithmetic step, quantity and shipping assumption.
- [ ] "Show query" displays Cypher and parameters.

### S06 Fix simulator
- [ ] Offers only changes that exist as Shopify settings.
- [ ] Shows leaks closed and good combinations broken.
- [ ] Never writes during simulation.
- [ ] Exports a change checklist.

### S07 Persistence and backup
- [ ] Survives a browser restart and explains a second-tab lock.
- [ ] Export then import gives the same findings.
- [ ] A failed import keeps the previous audit.

### S08 Import
- [ ] Templates for variants, collection membership and discounts, plus JSON.
- [ ] Shows errors by file and line and commits all or nothing.
- [ ] Re-import creates no duplicates.
- [ ] Money converts to minor units without float parsing.

### S09 Windows desktop app
- [ ] Same audit, proof and simulator as the browser.
- [ ] Unsigned portable build relaunches with data intact.
- [ ] Engine restart preserves acknowledged writes.

### S10 MCP
- [ ] Exposes four read-only tools.
- [ ] Sees committed changes while the app is open.
- [ ] README has a copy-paste setup.

## P1

### S11 Client report
- [ ] One offline HTML file with findings, proof, assumptions and fix checklist.

### S12 Draft-promotion check
- [ ] Shows only the leaks a proposed discount would add, before it is saved.

### S13 Margin floor
- [ ] A chosen percentage produces Thin without changing Leak results.

## Not in this version

Checkout blocking, writing to Shopify, discount creation, accounts, billing, order analytics, taxes and payment fees.

