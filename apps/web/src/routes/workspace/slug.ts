const SLUG_WORDS = ["space", "orbit", "atlas", "basin", "harbor", "meadow", "canyon", "delta"];

/** Fresh workspace session id (`word-NNNN`). */
export function randomSlug() {
  const word = SLUG_WORDS[Math.floor(Math.random() * SLUG_WORDS.length)];
  return `${word}-${Math.floor(Math.random() * 9000) + 1000}`;
}
