# 04 Sprints

One person, 5 hours a day, Nov 23 to Dec 11: **95 hours, 75 planned and 20 buffer**. Estimates are unvalidated.

| Sprint | Dates | Capacity | Planned | Buffer | Outcome |
|---|---|---:|---:|---:|---|
| 1 Rules and engine | Nov 23-26 | 20 | 19 | 1 | Proven groups at usable speed |
| 2 Browser product | Nov 27-Dec 1 | 25 | 19 | 6 | Public leak and fix demo |
| 3 Native, import, agents | Dec 2-5 | 20 | 17 | 3 | All P0 features |
| 4 Depth and draft entry | Dec 6-8 | 15 | 12 | 3 | P1 features, draft submitted |
| 5 Submit | Dec 9-10 | 10 | 8 | 2 | Final entry |
| Reserve | Dec 11 | 5 | 0 | 5 | Emergencies only |
| **Total** | | **95** | **75** | **20** | |

**Status, Nov 23:** Sprints 1-4 are built, apart from L405 (Devpost draft) and the desktop tasks L302-L303, which are out of scope.

## Sprint 1: Rules and engine

| Task | Work | Feature | Hours | After |
|---|---|---|---:|---|
| L101 | Monorepo, pins, `.gitattributes`, adapters | S01 | 3 | |
| L102 | Development-store checkouts for D4-D10 | S02 | 4 | |
| L103 | Schema and pair derivation with reasons | S02 | 3 | L101, L102 |
| L104 | Group and leak queries, completeness check | S03 | 4 | L103 |
| L105 | Load gate and query restructure | S03 | 2 | L104 |
| L106 | Sample, committed store, parity and clone tests | S01 | 3 | L104 |
| | **Total** | | **19** | |

**Status:** L101 and L103-L106 done. L102 done on 2026-11-23 against a Shopify Plus development store.

**Exit gate:** both sample leaks match, the false trio is absent, and 500 variants with 15 discounts audit in under 3 seconds in WASM.

## Sprint 2: Browser product

| Task | Work | Feature | Hours | After |
|---|---|---|---:|---|
| L201 | Worker, states, cancel | S04 | 3 | L106 |
| L202 | Audit board | S04 | 4 | L201 |
| L203 | Group drawing, arithmetic, query drawer | S05 | 4 | L202 |
| L204 | Fix ranking and simulation | S06 | 4 | L203 |
| L205 | OPFS, lock, backup | S07 | 3 | L201 |
| L206 | Static deploy with CSP | S04 | 1 | L202 |
| | **Total** | | **19** | |

**Exit gate:** someone new explains the Jacket leak and its fix within 60 seconds.

## Sprint 3: Native, import and agents

| Task | Work | Feature | Hours | After |
|---|---|---|---:|---|
| L301 | CSV and JSON import, preview | S08 | 5 | L205 |
| L302 | Electron shell and engine process | S09 | 5 | L204 |
| L303 | Portable package without asar | S09 | 2 | L302 |
| L304 | Four MCP tools and setup screen | S10 | 3 | L204 |
| L305 | End-to-end smoke on all surfaces | S08-S10 | 2 | L301, L303, L304 |
| | **Total** | | **17** | |

**Exit gate:** every P0 criterion passes.

## Sprint 4: Depth and draft entry

| Task | Work | Feature | Hours | After |
|---|---|---|---:|---|
| L401 | Client report | S11 | 2 | L204 |
| L402 | Draft-promotion check | S12 | 3 | L204 |
| L403 | Margin floor | S13 | 2 | L104 |
| L404 | README in the organizer's template | | 3 | L305 |
| L405 | Devpost draft | | 2 | L404 |
| | **Total** | | **12** | |

**Exit gate:** a valid draft entry exists by Dec 8.

## Sprint 5: Submit

| Task | Work | Hours | After |
|---|---|---:|---|
| L501 | Clean-machine README run | 2 | L405 |
| L502 | Accessibility and fixes | 2 | L501 |
| L503 | Video | 3 | L502 |
| L504 | Submit and check logged out | 1 | L503 |
| | **Total** | **8** | |

**Exit gate:** submitted by Dec 10.

## Model and effort by task

Use the cheapest model that can do the task safely. Anything that decides whether money is lost gets the strongest one.

| Work | Tasks | Model | Effort | Why |
|---|---|---|---|---|
| Rules, Cypher, scaling, fix ranking | L103-L105, L204, L402 | Opus | High | A wrong answer is a false Clear |
| Independent test evaluator | L106 | Sonnet | Medium | Bounded spec, kept apart from the engine's author |
| Visual direction, interface review | L202-L203, sprint gates | Opus | Medium | Judgment, using the better-* skills |
| Screens, import, MCP | L201, L205, L301, L304, L401 | Sonnet | Medium | Clear contracts and tests |
| Electron packaging and process handling | L302-L303 | Sonnet | High | Known native-module traps |
| Scaffolding, CI, fixtures, link checks | L101, L206 | Haiku | Low | Mechanical and easy to verify |
| Final correctness and security review | L501 | Opus | High | Last gate before submission |

Delegated work is reviewed and its tests re-run before it is committed.

## If we fall behind

Cut in this order:

1. S13 margin floor (2 hours)
2. S11 report (2)
3. S12 draft check (3)
4. S08 CSV, keeping JSON (3)
5. S09 packaging (2)
6. S09 desktop entirely (a further 5)

Never cut: all-pairs correctness, Unknown states, proof, browser demo, committed store, README, video.

| Checkpoint | If this is not true | Then |
|---|---|---|
| Nov 24 | A development store is available | Label the rules Assumed, or change project |
| Nov 26 | Load gate passes | Reduce supported size, cut 1 and 2 |
| Dec 1 | Public demo is live | Cut 3 and 4 |
| Dec 4 | Desktop opens the sample | Cut 5, then 6 |
| Dec 8 | Draft is submitted | Stop features and submit |

## Needed from you

| By | Action |
|---|---|
| Nov 23 | Approve L1-L7, register |
| Nov 24 | Create a Shopify development store, with Plus features if available |
| Nov 24 | Create the repository, or authorize me to |
| Dec 1 | Authorize hosting |
| Dec 8 | Show the audit to two agencies |
| Dec 10 | Approve the video and submit |

## Definition of done

Acceptance criteria pass, both engines agree, rule assumptions are visible, no real merchant data is committed, and setup docs are current.
