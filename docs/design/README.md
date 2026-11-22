# Design system

| Source | What it decides |
|---|---|
| [inspiration/app-branding-colors.webp](inspiration/app-branding-colors.webp) | Every brand color, sampled pixel by pixel, plus the glow and the dashed guide |
| [inspiration/dashboard-layout.webp](inspiration/dashboard-layout.webp) | Layout, measured: window, seams, sidebar, top bar, segmented switch, centered prompt, three cards, dots |
| [tokens.css](../../apps/web/src/tokens.css) | The only place values are defined |
| [REVIEW.md](REVIEW.md) | The interface review of the built app |

The two images are third-party references. Their names, logos, copy and artwork are not used in the product.

## Principles

1. **One question per screen.** Home: is this promotion safe to launch? Audit: what is losing money? Product: why, and how do I fix it?
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
