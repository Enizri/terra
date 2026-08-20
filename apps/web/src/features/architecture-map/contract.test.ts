import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { TerraMap } from "./types.ts";

test("packages/contracts/fixtures/analysis-map.v1.json fits TerraMap", () => {
  const fixturePath = path.join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "packages",
    "contracts",
    "fixtures",
    "analysis-map.v1.json",
  );
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as TerraMap;
  assert.ok(raw.project?.name);
  assert.ok(raw.project?.repository_url);
  assert.ok(Array.isArray(raw.components) && raw.components.length > 0);
  assert.ok(Array.isArray(raw.relationships));
  assert.ok(Array.isArray(raw.suggested_questions));
  for (const c of raw.components) {
    assert.ok(c.id && c.name && c.purpose && c.type && c.importance);
    assert.ok(["critical", "high", "medium", "low"].includes(c.importance));
  }
});
