// Match a traced request path to a map component (client-side heuristics).

import type { Component } from "./types";

const NOISE = new Set(["api", "v1", "v2", "rpc", "rest", "graphql"]);

const stem = (s: string) => (s.endsWith("s") && s.length > 3 ? s.slice(0, -1) : s);

/** Tokenize a path; drop package prefix before *Service in RPC paths. */
export function pathTokens(path: string): string[] {
  const tokens = path
    .toLowerCase()
    .split(/[/._\-?#]+/)
    .filter((t) => t && !NOISE.has(t));
  const svc = tokens.findIndex((t) => t.length > 7 && t.endsWith("service"));
  if (svc >= 0) {
    return [tokens[svc].slice(0, -"service".length), ...tokens.slice(svc + 1)];
  }
  return tokens;
}

function tokenScore(token: string, cand: string): number {
  if (!cand) return 0;
  if (stem(token) === stem(cand)) return 3;
  // Skip short candidates to avoid false substring hits.
  if (cand.length > 3 && (token.includes(cand) || cand.includes(token))) return 2;
  return 0;
}

/** Best-matching component id for a request path, or null. */
export function matchSpan(path: string, components: Component[]): string | null {
  const tokens = pathTokens(path);
  if (tokens.length === 0) return null;

  let bestId: string | null = null;
  let bestScore = 0;
  for (const c of components) {
    const leaf = c.id.split(".").pop() ?? "";
    const name = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    let score = 0;
    for (const token of tokens) {
      score += Math.max(tokenScore(token, leaf), tokenScore(token, name));
      for (const f of c.files) {
        for (const seg of pathTokens(f)) {
          if (stem(seg) === stem(token)) {
            score += 2;
            break;
          }
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = c.id;
    }
  }
  return bestScore >= 2 ? bestId : null;
}

/** The diagram only draws top-level cards, so child hits pulse their parent. */
export function topLevelId(id: string): string {
  return id.split(".")[0];
}
