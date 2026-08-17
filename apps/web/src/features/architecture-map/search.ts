import type { Component } from "./types";

/**
 * Ranked component search over the fields a person would type: name, purpose,
 * type, tech and file paths. Rank matters more than recall here — "auth" hits
 * half a map through `purpose`, so name matches must come out on top.
 */
export function matchComponents(components: Component[], query: string, limit = 8): Component[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: { c: Component; rank: number }[] = [];
  for (const c of components) {
    const name = c.name.toLowerCase();
    let rank: number;
    if (name.startsWith(q)) rank = 0;
    else if (name.includes(q)) rank = 1;
    else if (c.id.toLowerCase().includes(q)) rank = 2;
    else if ((c.tech ?? []).some((t) => t.toLowerCase().includes(q))) rank = 3;
    else if (c.type.includes(q)) rank = 4;
    else if (c.files.some((f) => f.toLowerCase().includes(q))) rank = 5;
    else if (c.purpose.toLowerCase().includes(q)) rank = 6;
    else continue;
    scored.push({ c, rank });
  }
  // Stable within a rank: map order is the analyzer's own importance ordering.
  return scored
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((s) => s.c);
}
