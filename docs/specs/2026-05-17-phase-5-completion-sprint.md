# Phase 5 — completion sprint

**Date:** 2026-05-17
**Status:** Draft — awaiting user review
**Parent spec:** [`2026-05-16-multi-activity-journal-design.md`](./2026-05-16-multi-activity-journal-design.md) (§ "v1 implementation deviations" enumerates what this phase closes)

## TL;DR

The Wave 2–4 build shipped a working four-activity-type UI but with seven documented simplifications, plus one undocumented gap surfaced after the Russian-locale wave: six wizard pages were never i18n'd. Phase 5 closes both — the documented deviations and the i18n gap — and lands the journal at feature-complete v1.

This is an implementation-plan doc, not a redesign. Architecture is set in the parent spec. Open questions at the bottom must be answered before the writing-plans step.

## Scope

| In | Out (v2+, per parent spec) |
|---|---|
| i18n retrofit on 6 wizard pages + the hardcoded `SPREAD_TYPES` copy | New activity types (Staking, Lending, LP, Liquidation, OTC, NFT) |
| Spread variant canonical select (replace the free-text "subtitle" shim) | Auto-MTM price imports for Sale/Airdrop |
| Sale wizard expansion (2 → 5 steps: token → allocation → vesting → claims → journal) | Tax exports |
| Airdrop wizard expansion (2 → 3 steps + surfaces missing `snapshot_date` / `eligibility_reason` / `claim_tx_hash`) | Mobile layouts |
| Sale vesting-timeline component (the "centerpiece" of Sale detail per spec) | Cmd+K palette |
| Real DB writes — replace fixture-redirect path; remove "Preview only" banner | Multi-user-per-instance |
| Spread leg table reads — remove the venue-string parsing in `/spreads/[id]` | Stripe billing / hosted SaaS |
| Trade detail real-field binding — replace base-price inference | |
| Draft auto-save on deep wizard steps (optional — see G9) | |

## Task groups

### G1 — i18n retrofit on early wizard pages (new — not in parent spec)

**Problem.** The Russian-locale wave i18n'd the `/add` menu and the deep `fields`/`review` steps, but left six in-between pages on hardcoded English. Russian users hitting `+Add → Spread` read English through three screens before reaching the polished step 4 (Fields). The mid-flow language break is the most visible quality defect right now.

**Files (lines / has-i18n):**
- `src/app/add/layout.tsx` (51, no)
- `src/app/add/spread/source/page.tsx` (41, no)
- `src/app/add/spread/pick/page.tsx` (255, no)
- `src/app/add/spread/pick/manual-builder.tsx` (298, no)
- `src/app/add/spread/type/page.tsx` (163, no — includes 5 hardcoded `SPREAD_TYPES` titles/descriptions)
- `src/app/add/trade/source/page.tsx` (37, no)
- `src/app/add/trade/pick/page.tsx` (189, no)

**Approach.** New i18n namespaces under `wizard.spread.{source,pick,type,manual}.*` and `wizard.trade.{source,pick}.*`. Replace every visible string with `t("…")` via `getT` (server) / `useT` (client). The five `SPREAD_TYPES` copies translate into crypto-Russian using the loanword vocabulary already established in `ru.ts` (`спред`, `фандинг`, `базис`, `календарный спред`, `dex-cex` as-is).

Estimated dictionary growth: ~30 new keys per locale.

### G2 — Spread variant canonical select

**Problem.** The schema constrains `variant` to two values per type:

| `spread_type` | Allowed `variant` |
|---|---|
| `cash_carry`     | `funding` (held for funding) · `basis` (basis trade) |
| `funding_capture` | `same_venue` (spot + perp same exchange) · `cross_venue` (long-short perps across exchanges) |
| `cross_exchange`, `calendar`, `dex_cex` | none |

The wizard exposes variant as a free-text subtitle in `/add/spread/fields/page.tsx`, then `mapVariantToCanonical()` in `actions.ts` hand-maps the typed text to a canonical value. This is fragile, doesn't surface the meaningful decision (cross-venue perps vs single-venue, basis vs funding), and forces the user to type a label they may type slightly differently each time.

**Approach.** Surface variant as a sub-row of cards in `/add/spread/type/page.tsx`, revealed only when the chosen type takes a variant. Carry the canonical value via URL param into `/fields`. Drop `mapVariantToCanonical` — wizard writes canonical directly.

**User-facing labels (proposed; see Open Q1):**
- `cash_carry` → "Held for funding" / "Basis trade"
- `funding_capture` → "Single venue" / "Cross venue (long-short perps)"

The cross-venue label is the one to argue about — it's the variant that captures the specific case the user described in brainstorming ("long-short perps").

### G3 — Sale wizard expansion (2 → 5 steps)

**Per parent spec § Wizard flows / Sale.** Current flow is `fields → review` (everything in one fat form). Spec calls for: `token → allocation → vesting → claims → review`.

**Step breakdown:**

1. **`/add/sale/token`** — `sale_kind` (radio: `ido | launchpad | premarket | otc`), `token_symbol`, `token_name`, `token_chain`.
2. **`/add/sale/allocation`** — `sale_venue`, `sale_date`, `usd_paid`, `tokens_allocated`. Live-computes `effective_price_usd`.
3. **`/add/sale/vesting`** — `vesting_schedule` JSONB. Three sub-modes:
   - **Full at TGE** → `{tge_pct: 100}`
   - **Cliff + linear** → form for `tge_pct`, `cliff_days`, `linear_days`
   - **Custom** → JSON editor (gated; see Open Q2)
4. **`/add/sale/claims`** — optional past `claim_events` array. List with "+ Add claim" affordance; each entry: `date`, `qty`, `tx_hash`.
5. **`/add/sale/review`** — summary + save (renamed from existing).

The current `/add/sale/fields/page.tsx` content distributes across steps 1–4; the existing `/add/sale/review/page.tsx` becomes step 5. Server action writes both `activity` + `activity_sale` rows in one transaction with `claim_events` JSONB.

### G4 — Airdrop wizard expansion (2 → 3 steps + missing fields)

**Per parent spec § Wizard flows / Airdrop.** Current flow is `fields → review`. Spec calls for: `token → claim → review`. Plus three schema fields the wizard doesn't currently collect: `snapshot_date`, `eligibility_reason`, `claim_tx_hash`.

**Step breakdown:**

1. **`/add/airdrop/token`** — `protocol`, `token_symbol`, `token_name`, `token_chain`, `snapshot_date`, `eligibility_reason`.
2. **`/add/airdrop/claim`** — `claim_date`, `claim_tx_hash`, `qty_received`, `value_at_receipt_usd`.
3. **`/add/airdrop/review`** — summary + save.

### G5 — Sale vesting-timeline component

**Per parent spec § Detail pages / Sale.** The vesting timeline is the "centerpiece" of `/sales/[id]`. Currently rendered as an allocation table.

**Component:** `src/components/sale/vesting-timeline.tsx`

**Inputs:** `vesting_schedule` JSONB + `claim_events` array + `sale_date` + `tokens_allocated`.

**Render:** SVG-based, no chart library (consistent with the editorial aesthetic).
- TGE marker (vertical rule at `sale_date`)
- Cliff bar (gray block: `sale_date` → `sale_date + cliff_days`)
- Linear-vest gradient (linear fill: `cliff_end` → `cliff_end + linear_days`)
- Today marker (vertical rule at `now()`)
- Claim event dots (one per `claim_events` entry)
- Legend (right side): vested-today %, total claimed %, locked %

**Math:** `vested(t) = tge_amount + clamp((t - cliff_end) / linear_days, 0, 1) × (allocated - tge_amount)`

### G6 — Real DB writes (remove "Preview only" banner)

**Per parent spec § v1 deviations / Persistence.** All four wizards' `actions.ts` files currently log the payload and redirect to a fixture ID with `?from=wizard`, which the detail page reads to render the "Preview only" banner.

**Approach.** Each `actions.ts` does an INSERT to `activity` + `activity_<type>` (transactional), returns the new UUID, redirects to `/{type}s/{uuid}` without the `?from=wizard` flag. The Spread wizard already writes real DB; verify only.

Sale (G3) and Airdrop (G4) wizard restructures share this work — they can't ship as 5-step / 3-step flows until persistence is real, so G6 is a prerequisite.

### G7 — Spread leg table reads

**Per parent spec § v1 deviations / Spread legs decomposition.** `/spreads/[id]/page.tsx` currently parses the `venues` string ("Bitmex + Coinbase" → 2 legs). Works for 16 fixtures, breaks for 3+ venues or unusual formatting.

**Approach.** Add `getSpreadLegs(activityId)` in `src/lib/db/activity.ts` that reads `spread_leg` table; replace the venue-string parse in the detail page with the table read.

### G8 — Trade detail real-field binding

**Per parent spec § v1 deviations / Trade detail decomposition.** Entry / exit / qty / fees are currently inferred from a per-asset base-price table because the fixtures only carry aggregates.

**Approach.** Bind directly to `activity_trade.{avg_entry_price, avg_exit_price, qty, …}` once G6 lands real DB rows. Remove the inference helper.

### G9 — Draft auto-save (optional)

**Per parent spec § Risks / Draft persistence.** Spec mentions `status='draft'` rows that auto-expire after 7 days. Lower priority than G1–G8; ship if time permits, otherwise punt to v1.1.

Scoped to the picker step only — that's the step with the most state worth not losing on tab close. Other steps' state lives in URL params and is cheap to recompute.

## Sequencing

| Order | Group(s) | Why |
|---|---|---|
| 1 | **G1** | Smallest blast radius, highest user-visible win. Locks in the locale-switch wave's investment. |
| 2 | **G2** | Small surgery. Closes the "your funding sub-flavors aren't there" gap raised in brainstorming. |
| 3 | **G6** | Prerequisite for G3 / G4 — no point expanding wizards that don't persist. |
| 4 | **G3** ∥ **G4** | Parallel. Independent. Both depend on G6 only. |
| 5 | **G5** | Depends on G3 (vesting data needs to actually exist). The visual centerpiece — best done after data is real. |
| 6 | **G7** ∥ **G8** | Parallel backend cleanup. Low user-visible impact but removes fragile code paths. |
| 7 | **G9** | Optional polish; punt to v1.1 if shipping pressure exists. |

Estimated session count (each group fits in one focused implementation session): 8 sessions in series + 2 parallel pairs. So roughly **6 working-day equivalents** of focused work for a single implementer.

## Risks

- **G2 variant restructure breaks fixture-rendered spreads.** Fixtures may have free-text variant subtitles that don't map cleanly. Mitigation: keep `mapVariantToCanonical` as a fallback through G2, remove only after fixtures are migrated.
- **G6 surfaces schema bugs.** Going from log-and-redirect to real INSERT will hit constraints not previously exercised. Mitigation: run all 4 wizards end-to-end against a fresh `pnpm db:reset` database before declaring G6 done.
- **G3 vesting-schedule shape drift.** JSONB has no enforced shape at the DB layer. Mitigation: canonical zod schema in `zod-schemas.ts` validates at API boundary; timeline component (G5) consumes the same canonical type.
- **i18n key collisions** under the new namespaces. Mitigation: each group of keys is `wizard.<type>.<step>.*` — namespaced enough to never overlap.
- **Russian translation quality.** Crypto-native Russian is loanword-heavy and full of slang. Mitigation: reuse vocabulary already in `ru.ts`; flag uncertain translations for user review.

## Open questions

These need user answers before the writing-plans step turns this into a task list.

1. **Variant labels (G2).** Approve "Held for funding" / "Basis trade" for `cash_carry`, and "Single venue" / "Cross venue (long-short perps)" for `funding_capture`? Or different copy?

2. **Vesting "Custom" mode (G3).** Ship JSON editor in v1, or restrict to TGE-only + cliff+linear and defer custom to v2?

3. **Airdrop without claim (G4).** If the user logs an eligible-but-not-claimed airdrop, do we allow `claim_date` / `claim_tx_hash` to be null and the activity status to be `pending`? (Parent spec allows it; just confirming the wizard wires it.)

4. **G9 priority.** Ship draft auto-save in this sprint, or defer to v1.1?

5. **`/spreads/demo` page.** It's an intentional marketing fixture today. Once G6 is in, do we want to also keep the demo as a public-facing "what this looks like" page (no auth), or remove it?

## Approval gates

This doc must be reviewed and the Open Questions answered before invoking writing-plans. After approval and per-task plan generation, the implementation order is fixed and each task gets verified independently against the parent spec's acceptance criteria (§ "v1 implementation deviations" closes each item) plus the additions from G1.
