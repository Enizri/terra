# Readable Globe Scroll Flow

## Goal

Extend the existing page journey with a second, clean-globe phase between the FAQ and the dark Terra footer. The hero and its current character-stream transition remain unchanged. Only after that transition does the antique celestial globe assemble in the FAQ-to-footer bridge, producing a final visual transition from code noise to something readable for humans.

## Choreography

The existing character globe and its initial scroll behavior remain unchanged:

1. The settled hero shows the antique globe surrounded by its code characters.
2. The characters perform their existing peel-and-stream transition as the user leaves the hero.
3. After the character stream and FAQ, colored fragments of the antique globe emerge from the bottom of the blank bridge at a very small scale.
4. Continued scrolling grows those fragments into the complete real globe with no characters, settling it in the bridge above the footer.
5. Once assembled, the globe remains in place and rotates gently while the bridge/footer boundary is visible.

The later clean-globe movement is bound directly to scroll progress, not an independent timed animation. Reversing the scroll reverses the same path without a jump. No characters accompany the globe during this second phase.

## Implementation Boundary

Reuse `GlobeJourney`, its existing scroll progress, and the current Three.js celestial-globe renderer. Keep the glyph progress calculation unchanged. Add a blank dock after the FAQ and derive a separate assembly progress from that dock’s viewport position. The sphere renderer uses its real painted texture with a coarse fragment reveal during emergence, then holds the assembled mesh and rotation while the dock is visible. Do not create a second globe instance, add a new animation framework, or change the FAQ/footer content.

The destination coordinates continue to come from the live right-hand demonstration panel geometry so the motion stays aligned across supported desktop sizes. Mobile keeps the globe below the hero copy and uses a shorter centered-to-right path that cannot cover the calls to action.

## Motion and Accessibility

Normal motion keeps the existing hero-to-character-stream choreography, then uses one smooth eased assembly with no bounce or overshoot. The globe continues a slow axial rotation after the assembly settles.

With `prefers-reduced-motion: reduce`, no flight plays: the hero keeps its static globe presentation and the Power section remains directly readable without an animated overlay.

## Verification

- Unit checks prove the existing hero character phase is unchanged and the later bridge assembly starts afterward and remains opaque at its endpoint.
- Browser checks cover the original hero, original character stream, colored fragment emergence, assembled bridge globe, continued rotation, reverse scrolling, mobile geometry, and reduced motion.
- The globe never carries code characters in the bridge and never exposes stand, ring, or support geometry.
- `npm test`, `npm run build`, `npm run lint`, and the repository `make check` remain green.
