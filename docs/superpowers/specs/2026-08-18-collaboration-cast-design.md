# Collaboration playground cast replacement

## Goal

Replace the existing people shown in the landing-page collaboration playground with three original 3D avatars and matching fictional cursor labels. The public snapshot must not retain the old people images when they have no remaining references.

## Approved cast

| Name | Role in the animation | Existing cursor color |
|---|---|---|
| Evyatar | Navigation edit | Amber |
| Maya | Card edit | Indigo |
| Leo | Activity-graph edit | Green |

## Visual direction

- Friendly, polished 3D head-and-shoulders characters.
- Three clearly different fictional people with varied features and styling.
- Simple pastel backgrounds matched to each cursor color.
- Faces must remain recognizable in the 48 px presence avatars.
- No text, logos, watermarks, celebrity likenesses, or Apple Memoji assets.
- Generate original artwork rather than using stock photography.

Each collaborator ships as matching PNG and WebP files under `apps/web/public/terra/images/`. The image base names will be descriptive rather than numbered so the data and assets remain easy to audit.

## Code changes

- Reduce the landing collaboration data to the three approved collaborators.
- Update the animation cursor assignments so Evyatar, Maya, and Leo appear next to their respective cursors.
- Keep the existing animation timing, paths, messages, and cursor colors unchanged.
- Point the presence avatars at the new descriptive image bases.
- Increase the presence avatars from 22 px to 48 px, enlarge the pill padding to fit, and keep a balanced 12 px overlap.
- Replace the three empty author circles in the playground memo cards with the matching Evyatar, Maya, and Leo avatars and names.
- Remove old avatar files only after a repository-wide reference check proves they are unused.

## Verification

- Add one small test asserting the three visible cursor names and collaborator assignments.
- Run the focused web test, `npm run build`, and `make check`.
- Review the playground at desktop and narrow widths, confirming avatar crops and cursor labels remain readable.
- Confirm all three visible playground memo cards show a real collaborator image rather than an empty placeholder circle.
- Confirm no removed avatar filename is referenced anywhere in tracked source.

## Out of scope

- Changing the collaboration animation choreography or messages.
- Redesigning the playground layout beyond sizing the existing presence pill for the larger avatars.
- Changing avatars elsewhere unless they use the same now-unused files.
