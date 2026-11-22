# 03 UX and demo

## Principles

1. Open on a working audit.
2. Every leak is one click from its arithmetic and one more from a fix.
3. Assumptions sit beside results, never in a footer.
4. Simulation is visibly different from imported settings.

## Navigation

```text
Audit | Discounts | Products | Import | Connect agent          Store: Demo v
```

## S1 Audit (home)

```text
+-----------------------------------------------------------------------------+
| 2 leaking products    1 unknown    47 clear in model       [Import store]   |
| Assumes: one product per cart, qty 1-3, shipping costs $8                   |
+----------------------------+---------------------------+--------------------+
| PRODUCTS                   | WHY JACKET LEAKS          | FIX                |
|                            |                           |                    |
| X Jacket   -$5.00 / order  |        BUNDLE20           | Stop BUNDLE20      |
| X Boots    -$2.00 / order  |         /    \            | combining with     |
| ? Gift box  cost missing   | WELCOME15 -- FREESHIP     | shipping           |
| + Cap       clear in model |                           |                    |
| + ...                      | Price              $100   | Closes 1 leak      |
|                            | BUNDLE20            -20   | Breaks N safe      |
|                            | WELCOME15           -12   | combinations       |
|                            | Shipping you pay     -8   |                    |
|                            | You keep            $60   | [Simulate]         |
|                            | Cost                $65   | [Add to checklist] |
|                            | Loss                 $5   | [Show query]       |
+----------------------------+---------------------------+--------------------+
```

Below 800px the panes become tabs. Clicking a triangle edge shows the rule allowing that pair.

## S2 Discounts

Table with class, method, amount, scope, dates, allowed classes, tags and leaks involved. A matrix view shows which pairs combine and why.

## S3 Products

Table with price, cost, worst stack, worst net and state. Missing costs are editable inline.

## S4 Import

Choose files, preview, fix errors, choose store settings (Plus, shipping cost, maximum quantity), confirm.

## S5 Connect agent

Store path, configuration snippet and "Is it safe to add a 25% VIP code?"

## States to build

| State | What the user sees |
|---|---|
| Loading | Skeleton and "Starting local graph" |
| Empty | Load sample, or import |
| Audit running | Progress and cancel (terminate and reopen the worker) |
| Search incomplete | Unknown, with the discounts responsible |
| Unsupported discount | Unknown, with type and name |
| No leaks | "No leaks in the modeled rules", with exclusions |
| Workspace locked | "Open in another tab", retry |
| Engine stopped | Restart, saved changes kept |

## Language

Use Leak, Thin, Unknown and Clear in model. Do not say safe, guaranteed or exact checkout price.

## Video script (target 1:50, limit 2:00)

| Time | Screen | Narration |
|---|---|---|
| 0:00-0:12 | Three promotions | "Twenty percent off. Fifteen for new customers. Free shipping. Each one is profitable." |
| 0:12-0:28 | Triangle turns red | "Together, this $100 jacket earns $60 and costs $65." |
| 0:28-0:45 | Click each edge | "It only happens because every pair may combine. Relate stores those rules as relationships." |
| 0:45-1:02 | Boots, trio with a missing edge | "It also finds tag stacks, and rejects groups where one pair can't combine." |
| 1:02-1:18 | Simulate fix | "One setting closes the leak. Here is what else that change would break." |
| 1:18-1:28 | Show query | "Cypher in Relate, in the browser. Margin data never leaves the machine." |
| 1:28-1:42 | Desktop and agent | "An agent checks the same local store before anyone creates the next promotion." |
| 1:42-1:50 | URL and repository | "StackLeak. Find the stack before your customers do." |
