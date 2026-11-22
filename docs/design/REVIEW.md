# Interface review: design mockup

## Scope and coverage

`docs/design/mockup.html` and `tokens.css`: all six views, plus simulated and invalid-submit states. Plain HTML and CSS with semantic tokens. Convention documents: `docs/design/README.md`, `docs/03-ux-and-demo.md`. The React app does not exist yet and was not reviewed.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Names, target sizes, tab stops with focus ring, empty-submit focus | Clear |
| Layout | 24 renders: six views at 1440, 1024, 720 and 320px | 2 fixed |
| Writing | All strings against the vocabulary | 1 fixed |
| Typography | Loaded faces, scale, screenshots | 1 fixed |
| Colors | Rendered text and control-border pairs | Clear |
| UI polish | Radii, icons, motion guards, screenshots | 1 fixed |

## Findings, all fixed

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Layout | Check view, intro badge | 44px sideways scroll at 320px | Track can shrink and the badge wraps | Reflow failed (1.4.10) |
| HIGH | Layout | Hash navigation | Switching views scrolled the top bar out of view | Panel IDs differ from routes, focus does not scroll | Navigation was hidden |
| MEDIUM | Typography | Stack graph at 320px | Labels rendered near 9px | 17px in SVG units, about 12px rendered | Below the size floor |
| LOW | UI polish | Fix panel label | Indented off the shared edge | Aligned | Broken alignment |
| LOW | Writing | Money | Hyphen as minus | True minus sign | Inconsistent with the product list |

## Verification

Headless Edge, driven over the DevTools protocol.

- Lowest text contrast: 6.37:1. No control boundary under 3:1.
- No unnamed control, target under 40px, horizontal overflow or console error in any of the 24 renders.
- Simulation updates totals and keeps focus. An empty submit explains the fix and returns focus.

**Not verified:** screen readers, 200% zoom, RTL, forced colors, long-string locales, Firefox, Safari, touch devices. The keyboard walk covered the audit view from the product list onward.

## Verdict

`Approve` for the mockup, for the coverage above. Run `better-interface` again on the React screens at the Sprint 2 gate.
