# Design system

Built with the `better-accessibility`, `better-layout`, `better-writing`, `better-typography`, `better-colors` and `better-ui` skills, and reviewed with `better-interface`.

| File | Purpose |
|---|---|
| [tokens.css](tokens.css) | The only source of color, type, space, radius and motion values |
| [mockup.html](mockup.html) | Interactive reference for every screen, with sample data |
| [inspiration/](inspiration/) | Visual references supplied by the project owner |

## What comes from each reference

| Reference | We take | We do not take |
|---|---|---|
| `app-branding-colors.webp` | Forest-to-cream atmosphere, dashed guides with crosses, small mono labels | Name, wordmark, knot symbol, icons, slogans, artwork |
| `dashboard-layout.webp` | Floating window, quiet sidebar, search, centered segmented switch, centered prompt with suggestion cards | Name, flame mark, purple accent, copy, avatar, icons |

The references are third-party work. They are not product assets and must not appear in the app, video or submission.

## Direction

A calm instrument inside a vivid green atmosphere. Expression lives outside the window and in the brand mark. Inside it, money and state are the loudest things.

- **Audit** is the first view and opens on a finished sample audit.
- **Check** is the centered prompt: describe the next promotion and see what it would leak.
- The mark is original and provisional: offset layers with one drop escaping. The product name lives in one config value until the rebrand.

## Rules

| Area | Rule |
|---|---|
| Color | Green is brand, selection and primary action. Red is a leak. Orange is unknown. "Clear in model" is neutral with a check, so green is never read as a guarantee |
| Emphasis | One filled action per view |
| State | Always icon plus word, never color alone |
| Type | Instrument Sans for interface, IBM Plex Mono for discount codes and small labels. Tabular numerals for money |
| Layout | Sidebar until it stops fitting, then a menu. Audit panes adapt with container queries. No page scroll sideways at 320px |
| Controls | Native elements, 40px targets, visible focus ring, labels on every input |
| Motion | Only exact properties, 150ms or less for frequent actions, press scale 0.96, nothing moves under reduced motion |
| Writing | Sentence case, verb-first buttons, errors say how to fix, simulation has undo instead of confirmation |
| Theme | Light window in v1. A dark theme repoints semantic tokens later |

## Vocabulary

| Use | Never |
|---|---|
| Leak | Error, violation |
| Unknown | Warning, skipped |
| Clear in model | Safe, guaranteed, passed |
| Stack | Bundle, chain |
| Simulate | Apply (nothing is written to Shopify) |
| Checklist | To-do list |
