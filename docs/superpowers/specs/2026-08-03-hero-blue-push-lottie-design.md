# Hero blue-push Lottie swap

**Date:** 2026-08-03  
**Status:** Implemented (Approach 2 — full Lottie + CSS crop; blend polish applied)  
**Scope:** Replace the hero wave-hand word-swap actor with the Jack Smith “Upload” Lottie, cropped to the blue rectangle, branded “Terra”.

## Goal

In the hero headline, keep the copy swap:

> Software that only **engineers** can understand → only **humans** can understand

Replace the hand Lottie (`wave-hand.json` / `HeroWaveHand`) with the real [Upload animation](https://lottiefiles.com/free-animation/upload-9NLpXybJCL) (Jack Smith, Lottie Simple License), shown so only the blue pusher is readable on the page.

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Source | Real Upload Lottie (not a CSS redraw) |
| Visible cast | Blue rectangle only (peach character, ruler, stage cropped away) |
| Face mark | White **“Terra”** word |
| After contact | Character keeps walking **and** fades out |
| Word swap | Existing fly-away for `engineers`, then `humans` |
| Approach | **Full Lottie + CSS crop/mask** (not a slim layer extract) |

## Non-goals

- Extracting/editing a separate blue-only Lottie JSON composition (Approach 1).
- Rebuilding the character in CSS/Framer.
- Changing hero copy strings (`engineers` / `humans`) or the rest of the landing page.
- Showing the peach character or ruler on the site.

## Current behavior (baseline)

`HeroTitle` in `web/src/terra/TerraLanding.tsx`:

1. Renders `copy.heroTitle` with swap slot `from: "engineers"` → `to: "humans"`.
2. After ~900ms, `HeroWaveHand` loads `/wave-hand.json`, rises, wrist-flicks, calls `onBump`.
3. `onBump` flies the old word off and shows `humans`.
4. Hand waves, exits, fades; `onDone` unmounts it.
5. Reduced motion skips the actor and shows `humans` immediately.
6. 12s fallback forces `humans` if the sequence stalls.

## Target behavior

1. Same ~900ms delay (or equivalent beat tuned to the Upload file).
2. Cropped Upload Lottie appears left of the swap word (same anchor as today’s hand).
3. Blue square (with **Terra** on its face) walks/pushes toward `engineers`.
4. At contact (chosen frame or timed cue): fire existing `onBump` / fly-away / `humans` reveal.
5. Lottie keeps playing (walk continues); the cropped actor fades out and unmounts (`onDone`).
6. Reduced motion + 12s fallback unchanged in intent.

## Architecture

### Units

1. **Asset** — Ship the Upload animation under `web/public/` (JSON for `lottie-web`, already used by the hero). Source file already fetched as `upload-push.json` / `upload-push.lottie` from LottieFiles assets CDN. Prefer JSON path consistent with `wave-hand.json`. Do **not** ship the exploratory preview GIF as a product asset.
2. **`HeroBluePush` (rename of / replacement for `HeroWaveHand`)** — Loads the Upload Lottie, no autoplay loop; drives segments or continuous play through contact → walk-away; fades wrapper opacity while walking; calls `onBump` / `onDone`.
3. **Crop stage (CSS)** — Wrapper with fixed aspect/size, `overflow: hidden`, and internal Lottie offset/scale so only the blue character sits in view. Peach / ruler / dark stage stay off-canvas.
4. **Terra label** — Absolutely positioned white “Terra” text centered on the visible blue face. Hide or cover any leftover face text in the Lottie (layer opacity via `lottie-web` if reliable; otherwise opaque cover under the Terra label).
5. **`HeroTitle`** — Keep swap / fly / reduced-motion / fallback; swap which actor child is mounted.

### Data flow

```
mount HeroTitle
  → (if motion ok) mount HeroBluePush
  → delay → play Upload Lottie in crop
  → contact cue → onBump → engineers flies, humans shown
  → continue play + fade wrapper → onDone → unmount actor
```

### Contact cue

Pick a frame (or short frame range) in the Upload timeline where the blue square makes contact with the pushed mass. Map that to `onBump`. If frame discovery is ambiguous during implementation, use a timed offset from play start that visually matches contact, and document the chosen frame numbers next to the constants (same style as today’s `RISE_SEGMENT` / `HOLD_FRAME`).

### Styling

- Reuse / adapt `.sh-hero-hand*` as `.sh-hero-push*` (or retarget existing classes) so sizing stays em-based beside the headline.
- Terra label: inherit brand-adjacent white type; small enough to fit the cropped blue face at mobile headline sizes (`min(…em, …vw)` like the hand).
- Pointer-events none; `aria-hidden` on the decorative actor.

## Error handling & a11y

- If Lottie fails to load: fall through to fallback timeout so copy still becomes `humans`.
- Decorative only: no focusable controls; title text remains the accessible content.
- `prefers-reduced-motion: reduce` → no actor, final copy.

## License

Lottie Simple License (free community animation). Keep a short attribution comment at the load site (creator: Jack Smith; source URL).

## Testing

Manual:

1. Desktop: blue Terra square appears, pushes, `engineers` flies, `humans` lands, actor walks while fading.
2. Mobile width: crop still hides peach/ruler; Terra readable; no horizontal clip from `.sh-section`.
3. Reduced motion: final “humans” line only.
4. Hard-refresh / slow network: fallback still resolves to `humans`.

## Implementation notes (for plan)

- Primary files: `web/src/terra/TerraLanding.tsx`, `web/src/terra/terra.css`, `web/public/upload-push.json` (or renamed), remove hero dependency on `wave-hand.json` for this beat.
- Prefer Approach 2 constraints: **do not** spend the plan on building a slim extracted composition unless crop proves impossible (peach leaking into frame). If crop fails QA, escalate to Approach 1 as a follow-up, not silent scope creep.

## Open implementation details (non-blocking)

Exact crop `object-position` / scale / contact frame numbers — to be fixed while implementing against the real file (375×337, 24fps, 240 frames).
