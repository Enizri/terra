# Readable Globe Scroll Flow

## Goal

Extend the existing hero-to-Power scroll journey so the antique celestial globe itself travels into the right-hand Terra demonstration panel. During this travel, the globe is shown without the surrounding code characters, producing a visual transition from code noise to something readable for humans.

## Choreography

The existing character globe remains unchanged in the settled hero state. When the user begins scrolling toward the Power section:

1. The character shell peels away before the antique globe starts moving.
2. The antique globe remains fully visible, round, and free of characters.
3. Continued scrolling moves it along a gentle downward-right curve toward the demonstration panel beside the “Ask / Implement / Monitor / Map / Collaborate” list.
4. The globe scales down slightly during the flight so it fits naturally within the destination panel.
5. At the end of the journey, the panel masks the globe cleanly as the existing Terra demonstration becomes the primary content.

The movement is bound directly to scroll progress, not an independent timed animation. Reversing the scroll reverses the same path without a jump.

## Implementation Boundary

Reuse `GlobeJourney`, its existing scroll progress, and the current Three.js celestial-globe renderer. Add only the minimum interpolation needed for the curved path and the separate timing of character disappearance versus globe travel. Do not create a second globe instance, a new animation framework, or change the Power section’s content.

The destination coordinates continue to come from the live right-hand demonstration panel geometry so the motion stays aligned across supported desktop sizes. Mobile keeps the globe below the hero copy and uses a shorter centered-to-right path that cannot cover the calls to action.

## Motion and Accessibility

Normal motion uses one smooth eased curve with no bounce or overshoot. The characters reach zero opacity before the clean globe becomes the moving focal point. The globe continues its existing slow axial rotation during travel.

With `prefers-reduced-motion: reduce`, no flight plays: the hero keeps its static globe presentation and the Power section remains directly readable without an animated overlay.

## Verification

- Unit checks prove the character shell is gone before globe travel begins and that the globe reaches the right-hand panel endpoint.
- Browser checks cover desktop start, character-free mid-flight, destination, reverse scrolling, mobile geometry, and reduced motion.
- The globe never carries the code characters during the bottom-to-right flight and never exposes stand, ring, or support geometry.
- `npm test`, `npm run build`, `npm run lint`, and the repository `make check` remain green.
