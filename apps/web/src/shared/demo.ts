/** Demo-build rules for the hosted beta.
 *
 * The hosted deployment runs with live preview refused at the door
 * (`TERRA_PREVIEW_MAX=0`) and no server-side provider key, so analyze and ask
 * are bring-your-own-key. That leaves a first-time visitor looking at an empty
 * stage, which is why a demo build seeds the bundled memos map instead.
 *
 * Nothing here reads `import.meta.env` — the build flags come in as arguments
 * so these rules stay testable under plain `node --test`. Call sites read the
 * env.
 */

/** Terra's own repository — the demo notice links into its SECURITY.md. */
export const TERRA_REPO_URL = "https://github.com/Enizri/terra";

/** Whether the bundled memos map should fill an otherwise empty stage.
 *
 * Dev keeps the `?fixture` opt-in it has always had. A demo build shows the
 * map by default so the product is legible before anything is pasted, and
 * `?nofixture` gets the empty stage back for screenshots. */
export function showFixture(search: string, dev: boolean, demo: boolean): boolean {
  const params = new URLSearchParams(search);
  if (demo) return !params.has("nofixture");
  return dev && params.has("fixture");
}
