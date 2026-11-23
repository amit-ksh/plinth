# 03 UX and demo

The visual source of truth is the built app and its [design system](design/README.md).

## Principles

1. Open on one question, with the sample's findings one click away.
2. Every leak is one click from its arithmetic and one more from a fix.
3. Assumptions sit beside results, never in a footer.
4. Simulation is visibly different from imported settings.

## Navigation

Sidebar: Home, Audit, Products, Discounts, Checklist, Import, Settings, then what needs attention.
Top bar: store menu (report, backup, import), Check or Audit, Connect an agent.

## Screens

| Screen | Question it answers |
|---|---|
| Home | Would this promotion sell anything below cost? |
| Audit | What is losing money, and what can't be checked? |
| Product | Why does it lose money, and what is the smallest fix? |
| Products | Where is a particular product? |
| Discounts | What can combine with what? |
| Checklist | What do I still have to change in Shopify? |
| Import | How do I bring in my store? |
| Settings | What does the math assume? |
| Connect an agent | How does my agent read this? |

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
| 1:28-1:42 | Claude Code over MCP | "An agent checks the same local store before anyone creates the next promotion." |
| 1:42-1:50 | URL and repository | "Plinth. Find the stack before your customers do." |
