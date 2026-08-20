# Readable Globe Scroll Flow

## Goal

Extend the existing hero-to-Power scroll journey with a second, clean-globe phase. The hero and its current character-stream transition remain unchanged. Only after that transition does the antique celestial globe grow out of the character funnel’s narrow endpoint and travel by itself into the right-hand Terra demonstration panel, producing a final visual transition from code noise to something readable for humans.

## Choreography

The existing character globe and its initial scroll behavior remain unchanged:

1. The settled hero shows the antique globe surrounded by its code characters.
2. The characters perform their existing peel-and-stream transition as the user leaves the hero.
3. After the character stream has moved into the Power section, the antique globe alone emerges from the funnel’s narrow endpoint at a very small scale.
4. Continued scrolling moves the clean globe along a gentle downward-right curve toward the demonstration panel beside the “Ask / Implement / Monitor / Map / Collaborate” list.
5. The clean globe grows during the flight, reversing the visual logic of the hero globe shrinking into the stream, until it fits naturally within the destination panel.
6. At the end of the journey, the panel masks the globe cleanly as the existing Terra demonstration becomes the primary content.

The later clean-globe movement is bound directly to scroll progress, not an independent timed animation. Reversing the scroll reverses the same path without a jump. No characters accompany the globe during this second phase.

## Implementation Boundary

Reuse `GlobeJourney`, its existing scroll progress, and the current Three.js celestial-globe renderer. Keep the glyph progress calculation unchanged. Add a separate clean-globe progress derived from the live demonstration-panel position: it starts only as the glyph phase reaches its endpoint and continues across the following portion of the Power-section scroll. Its origin is the existing glyph destination point, and its scale grows with the same eased travel. This gives the second flight enough distance without retiming the original character transition. Do not change the initial glyph layout, create a second globe instance, add a new animation framework, or change the Power section’s content.

The destination coordinates continue to come from the live right-hand demonstration panel geometry so the motion stays aligned across supported desktop sizes. Mobile keeps the globe below the hero copy and uses a shorter centered-to-right path that cannot cover the calls to action.

## Motion and Accessibility

Normal motion keeps the existing hero-to-character-stream choreography, then uses one smooth eased curve for the clean globe with no bounce or overshoot. The character phase reaches its existing endpoint before the clean globe becomes the moving focal point. The globe continues its existing slow axial rotation during travel.

With `prefers-reduced-motion: reduce`, no flight plays: the hero keeps its static globe presentation and the Power section remains directly readable without an animated overlay.

## Verification

- Unit checks prove the existing hero character phase is unchanged, the later sphere phase starts afterward, and the globe reaches the right-hand panel endpoint.
- Browser checks cover the original hero, original character stream, clean-globe re-entry, character-free mid-flight, destination, reverse scrolling, mobile geometry, and reduced motion.
- The globe never carries code characters during its later bottom-to-right flight and never exposes stand, ring, or support geometry.
- `npm test`, `npm run build`, `npm run lint`, and the repository `make check` remain green.
