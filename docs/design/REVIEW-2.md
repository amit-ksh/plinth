# Interface review 2: dashboard and navigation

Branch `ui-review`, against `main` at `0735cd0`. Skills: better-interface (orchestration), better-layout, better-ui, better-accessibility, better-colors, dataviz.

## Scope and coverage

All screens at 1440 and 375px, then the full sweep of 16 screens at 7 sizes (1440, 1024, 901, 768, 640, 375, 320) with axe-core WCAG 2.2 AA and an overflow check on every render.

| Domain | Evidence | Result |
| --- | --- | --- |
| Accessibility | axe-core on every render, keyboard walk, chart keyboard reading | 1 fixed |
| Layout | Screenshots at every size, overflow check | 3 fixed |
| Information design | Dashboard and calendar against dataviz forms | 3 fixed |
| Colors | Chart palette run through the dataviz validator, light surface | 1 fixed |
| UI polish | Screenshots, stylesheet rules | 2 fixed |

## Findings, all fixed

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | UI polish | `styles.css` input rule | Guardrail radios drawn as 40px browser-blue text boxes, labels squeezed into three lines | Radios share the checkbox rule: 18px, brand accent | A control that looks broken reads as broken; the generic `input` rule caught radios |
| HIGH | Layout | `charts.tsx` hidden table | The chart's screen-reader table widened the page to 736px on a 375px phone | Table wrapped in the `.sr` container | Sideways scroll at 320–375px (trigger) |
| MEDIUM | Information design | `views/Home.tsx` | Home was one list; no way to see the store's state at a glance | Dashboard: four stat tiles, losses as ranked bars, margins as a segmented bar, six weeks of leaks as columns, discounts behind the losses, what's scheduled | Merchants expect the Shopify Analytics pattern: headline numbers, then charts that link to detail |
| MEDIUM | Layout | `Shell.tsx` top bar | A Check/Audit switch repeated two sidebar links, and showed neither as selected on every other page | Removed; the top bar shows where the data comes from (sample, files, linked store) | Two navigation systems for one destination, one of them usually wrong |
| MEDIUM | Layout | `Shell.tsx` sidebar | Ten links in one flat list | Grouped: Overview, Promotions, Store; Home is Dashboard, Audit is Leaks | Groups make a long list scannable; names match what the pages show |
| MEDIUM | Information design | `views/Calendar.tsx` | A "Leaks" row printed "2" in 42 boxes | A column chart of products below cost per day, keyboard readable, then the discount timeline in its own card | A repeated number is a table pretending to be a chart; columns show change over time |
| MEDIUM | Layout | `views/Products.tsx`, `views/Discounts.tsx` | No way to narrow a long table | Status filters with counts: Below cost, Thin, Can't check, Healthy; Active, Scheduled, Ended, In a leak | The status tabs above every Shopify admin table |
| LOW | Layout | `views/Discounts.tsx` | Pause all sat alone above the table | Pause all at the end of the filter row; the confirmation and the paused banner sit above it | Table actions live with the table |
| LOW | Colors | `tokens.css` | Chart hues unspecified; first pick of green failed the chroma floor | Leak #a3262a, thin #b7791f, healthy #23713e pass every check (lightness, chroma, CVD ≥ 9.2, contrast ≥ 3:1); "can't check" gray always carries a label | Status colors must survive color vision deficiency and never stand alone |

## Charts follow these rules

- One baseline, 4px rounded data ends, a 2px surface gap between segments, no dual axis.
- Every value is readable without hover: printed at the bar's tip, in the legend, or in a hidden table for screen readers.
- The column chart reads day by day with the arrow keys and shows the same tooltip as on hover.
- Status hues only with a label, never as the only cue.

## Verification

- `npm run test:e2e`: every check passes, including axe on 16 screens at 7 sizes and the keyboard walk.
- Dataviz palette validator: all checks pass for the three status hues on the light surface.

**Not verified:** screen readers, dark mode (the app is light only), Firefox, Safari, touch devices.

## Verdict

`Approve` for the coverage above.
