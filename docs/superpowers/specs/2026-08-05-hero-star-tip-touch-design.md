# Hero star tip-touch word swap

**Date:** 2026-08-05  
**Status:** Approved design (Approach A)  
**Scope:** Reposition the hero backdrop star so a spoke tip physically meets the **E** of `engineers`, then drag + replace with `humans` along the existing spin-synced path.

## Goal

On first load, a spoke tip of the large backdrop star visibly lands on the **E** of `engineers`, pulls that word down with the star’s spin, and the next spoke delivers `humans` into the emptied slot. Contact should read as physical tip-on-letter, not an invisible arc grab from afar.

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Approach | **A** — nudge hero CSS position only (closer + a bit down) |
| Visible spoke line | **No** — tip itself does the contact |
| Auto-measure placement | **No** — fixed CSS vars, tuned by eye |
| Hero star size | Unchanged (`min(50.4vh, 72vw, 420px)`) |
| Final dock size / path | Unchanged |
| Mid-page section side-swaps | Unchanged (`±26vw`, `STAR_SECTION_DROP_VH`) |
| Word-swap mechanism | Keep existing spoke-angle grab / drag / ride in `HeroTitle` |

## Non-goals

- Drawing a connector line from star tip to letter
- JS that measures the **E** and writes `--sh-star-x/y` each frame or on load
- Growing the hero star to reach the word
- Changing headline copy, timing constants beyond small lead tweaks if needed after nudge
- Changing Final dock or scroll-driven side path

## Current behavior (baseline)

Files: `web/src/terra/terra.css`, `web/src/terra/TerraLanding.tsx`, `web/src/terra/HeroBackdrop.tsx`.

1. `.sh-backdrop` defaults to `translate: var(--sh-star-x, -20vw) var(--sh-star-y, 0px)`.
2. After handoff, `.sh-backdrop--parked` sets `--sh-star-x: -26vw`.
3. `HeroTitle` measures the word’s top-left (contact ≈ top of **E**), primes a spoke `PRIME_LEAD_DEG` before contact, grabs when a spoke angle wraps past `phi`, drags `engineers` on the polar arc, then rides `humans` in on the trailing spoke.
4. On a wide desktop, hero gap tip→word is already small (~10px) at `-20vw`; after park the star sits farther left. Visually the tip still often feels short of the **E**, especially once size/position diverge across viewports.

## Design

### 1. Hero placement (CSS)

On `.sh-backdrop` defaults:

| Var | From | To |
| --- | --- | --- |
| `--sh-star-x` | `-20vw` | `-12vw` |
| `--sh-star-y` | `0px` | `7vh` |

On `.sh-backdrop--parked`:

| Var | From | To |
| --- | --- | --- |
| `--sh-star-x` | `-26vw` | `-18vw` |

Rationale: closer (rightward) and a bit down so a rightward/near-horizontal spoke tip meets the **E** during the grab; parked keeps a modest left drift after the swap without jumping back to the old far-left hero offset.

Tune ±2vw / ±2vh in implementation if tip still misses or overlaps the headline too hard on common desktop widths.

### 2. Contact + drag (existing JS)

Keep `HeroTitle` spoke sync:

1. Arm after fonts ready; measure contact at top of **E**.
2. Prime nearest spoke just before contact.
3. On wrap past `phi`: grab → spin up → `engineers` rides spoke down and fades.
4. Trailing spoke (−60°) brings `humans` in → settle → park class → ambient spin.

Only change timing/geometry constants if the CSS nudge makes the tip overshoot or undershoot (e.g. slight `PRIME_LEAD_DEG` tweak). Do not replace the polar drag model.

### 3. Out of scope leftovers

- Section observer still uses `±26vw` and vertical drop — independent of hero defaults.
- Final dock still measures the glyph and eases over `STAR_DOCK_MS`.
- Reduced motion: still jump straight to `humans` (existing path).

## Success criteria

- On a typical desktop reload: a spoke tip visibly touches the **E** of `engineers` before the word moves.
- `engineers` leaves downward with the spin; `humans` replaces it on the next spoke.
- Star then parks slightly left; mid-page glide and Final dock still look smooth.
- No new line graphic; no hero size change; Final docked mark size unchanged.

## Implementation touchpoints

| File | Change |
| --- | --- |
| `web/src/terra/terra.css` | Hero `--sh-star-x/y` defaults; parked `--sh-star-x` |
| `web/src/terra/TerraLanding.tsx` | Optional tiny constant tweaks only if needed after visual check |

## Verification

1. Hard reload landing → watch tip meet **E** → drag → `humans` settle → park.
2. Scroll through mid sections → diagonal side path still smooth.
3. Reach Final → dock size/position unchanged vs pre-change.
4. Narrow / tall viewport spot-check: tip still near **E** or acceptable miss (no auto-layout).
