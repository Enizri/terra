// Maps a traced request path onto the component that most plausibly handled
// it — the wire between the live preview and the map. Pure heuristics over
// the map's own ids, names and files; no server round-trip.

import type { Component } from "./types";

/** Path segments that name plumbing, not a component. */
const NOISE = new Set(["api", "v1", "v2", "rpc", "rest", "graphql"]);

const stem = (s: string) => (s.endsWith("s") && s.length > 3 ? s.slice(0, -1) : s);

/**
 * "/api/v1/memos" → ["memos"]; "/memos.api.v1.MemoService/CreateMemo" →
 * ["memo", "creatememo"]. In RPC paths everything before the *Service token
 * is the app's package name — the same for every call, so it identifies
 * nothing and is dropped.
 */
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
  // "memoservice" contains "memo"; guard tiny candidates ("ai") against
  // matching half the alphabet.
  if (cand.length > 3 && (token.includes(cand) || cand.includes(token))) return 2;
  return 0;
}

/**
 * The component id a request path lights up, or null when nothing clears the
 * bar. Matches against each component's id leaf, name, and file segments.
 */
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
