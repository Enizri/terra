/**
 * Cap on simultaneously selected elements/cards — keeps inspect focus and
 * crumbs readable. One rule for every route; lives in its own React-free
 * module so `node --test` code can import it.
 */
export const MAX_SELECTIONS = 3;
