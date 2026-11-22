# Interface review: browser app

## Scope and coverage

The built app in `apps/web`: 14 screens and states at 1440, 1024, 901, 768, 640 (200% zoom equivalent), 375 and 320px, 98 renders in all. Stack: React and plain CSS with semantic tokens. Convention document: [README.md](README.md).

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | axe-core WCAG 2.2 A and AA on every render, keyboard walk, focus after actions | 1 fixed |
| Layout | Overflow check on every render, screenshots | 5 fixed |
| Writing | All strings against the vocabulary | 3 fixed |
| Typography | Screenshots, token scale | Clear |
| Colors | 54 token pairs computed, including surfaces axe cannot resolve over gradients | Clear |
| UI polish | Screenshots, stylesheet rules | 1 fixed |

## Findings, all fixed

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Writing | `views/Product.tsx` | A price already below cost showed no fix | Says to raise the price or correct the cost | The task was blocked |
| HIGH | Accessibility | `styles.css`, links in disclosures | Two targets under 24px | 40px | 2.5.8 |
| MEDIUM | Layout | `styles.css`, top bar | Wrapped to three rows on phones | One row | Pushed the task down |
| MEDIUM | Layout | `styles.css`, sidebar | Shortcuts clipped on short screens | Hidden there, still on Home and Audit | Hidden content with no cue |
| MEDIUM | Layout | `styles.css`, hero | Last line clipped at laptop height | Top space follows viewport height | Content below the fold |
| MEDIUM | Writing | Home, Audit | Claimed every possible stack was checked | Claims the modeled stacks | Overstated certainty |
| MEDIUM | UI polish | Sidebar search | Icon over the placeholder | Padding restored | Unreadable label |
| LOW | Layout | Rows on phones | A chevron alone on a line | Stays inline | Alignment |
| LOW | Layout | Window | Tighter margins than the reference | Fluid margins | Match the reference |
| LOW | Writing | Discounts | "With product" | "Combines with product" | Ambiguous |

## Verification

- `npm run test:e2e`: 40 checks pass in Edge and Chrome on Windows.
- Lowest text contrast 5.78:1. Lowest non-text 3.72:1.

**Not verified:** screen readers, RTL, forced colors, long-string locales, text spacing, touch devices, Firefox, Safari.

## Verdict

`Approve`, for the coverage above.
