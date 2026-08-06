const SLUG_WORDS = ["space", "orbit", "atlas", "basin", "harbor", "meadow", "canyon", "delta"];

/**
 * Session id for a fresh workspace: one word, one number. Its own file so the
 * router can name a new session without importing the route it redirects to.
 */
export function randomSlug() {
  const word = SLUG_WORDS[Math.floor(Math.random() * SLUG_WORDS.length)];
  return `${word}-${Math.floor(Math.random() * 9000) + 1000}`;
}
