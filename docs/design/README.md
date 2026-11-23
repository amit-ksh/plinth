# Design system

| Source | What it decides |
|---|---|
| [tokens.css](../../apps/web/src/tokens.css) | The only place values are defined |
| [REVIEW.md](REVIEW.md) | The interface review of the built app |

The palette and window layout began from mood-board references, which are not part of this repository. The home screen, mark and copy are original.

## Principles

1. **One question per screen.** Home: what is losing money now, and is the next promotion safe to launch? Audit: what is losing money? Product: why, and how do I fix it?
2. **Answer first.** The title is the answer ("Winter jacket loses $5.00"). Proof, queries and options sit behind named disclosures.
3. **Money reads as a receipt.** Nobody has to read a chart to understand a loss.
4. **One column, one filled button.**

## Rules

| Area | Rule |
|---|---|
| Color | Forest and cream are the brand. Green is selection and never means "safe". Red is only a leak, amber only unknown |
| State | Icon and words, never color alone |
| Type | Inter for the interface, Geist Mono for codes. Tabular numerals for money. Self-hosted |
| Icons | Hugeicons free, through the `Icon` component, stroke matched to text weight |
| Layout | 40px controls. The sidebar becomes a menu at 900px. No sideways scroll at 320px |
| Motion | Press scale and background only. No movement under reduced motion |
| Writing | Sentence case, verb-first buttons, errors say how to fix, undo instead of confirmation |
| Theme | Light. A dark theme would repoint semantic tokens |

## Vocabulary

| Use | Never |
|---|---|
| Leak, sells below cost | Violation, error |
| Can't be sure | Skipped, warning |
| No leak found | Safe, guaranteed |
| Stack | Bundle, chain |
| Preview | Apply (nothing is written to Shopify) |
| Checklist | To-do list |
