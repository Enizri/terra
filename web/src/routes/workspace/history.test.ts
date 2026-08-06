import assert from "node:assert/strict";
import test from "node:test";
import { HISTORY_CAP, toHistory } from "./history.ts";

const row = (id: number, scanned_at: string, repo = `github.com/u/r${id}`) => ({
  id,
  repo_url: repo,
  name: `r${id}`,
  scanned_at,
});

test("rows come out newest first regardless of input order", () => {
  const out = toHistory([
    row(1, "2026-08-01T10:00:00Z"),
    row(3, "2026-08-06T09:00:00Z"),
    row(2, "2026-08-03T12:00:00Z"),
  ]);
  assert.deepEqual(
    out.map((h) => h.id),
    [3, 2, 1],
  );
});

test("snake_case rows become camelCase entries", () => {
  assert.deepEqual(toHistory([row(7, "2026-08-06T09:00:00Z")]), [
    { id: 7, repoUrl: "github.com/u/r7", name: "r7", scannedAt: "2026-08-06T09:00:00Z" },
  ]);
});

test("the rail cap drops the oldest rows, not the newest", () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(i, `2026-07-${String(i + 10)}T00:00:00Z`));
  const out = toHistory(rows);
  assert.equal(out.length, HISTORY_CAP);
  assert.equal(out[0].id, 11);
  assert.equal(out[out.length - 1].id, 4);
});

test("an empty list stays empty", () => {
  assert.deepEqual(toHistory([]), []);
});
