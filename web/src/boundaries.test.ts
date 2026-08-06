// Mechanical guard for the import rules in ARCHITECTURE.md: routes must not
// import each other (or app/), and shared/ must not import a route or app/.
// Regex over source text, not a resolver — imports here are always relative
// with explicit extensions (no path aliases), so this is exact enough.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const src = import.meta.dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));
}

function importedDirs(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs = [...text.matchAll(/^import[^"']*["'](\.[^"']+)["']/gm)].map(
    (m) => m[1],
  );
  return specs.map((s) => path.resolve(path.dirname(file), s));
}

test("routes import only themselves, shared/, and data/", () => {
  const routesDir = path.join(src, "routes");
  for (const route of readdirSync(routesDir)) {
    const own = path.join(routesDir, route);
    for (const file of sourceFiles(own)) {
      for (const target of importedDirs(file)) {
        const ok =
          target.startsWith(own + path.sep) ||
          target.startsWith(path.join(src, "shared") + path.sep) ||
          target.startsWith(path.join(src, "data") + path.sep);
        assert.ok(ok, `${file} imports outside its route: ${target}`);
      }
    }
  }
});

test("shared/ never imports routes/ or app/", () => {
  for (const file of sourceFiles(path.join(src, "shared"))) {
    for (const target of importedDirs(file)) {
      const ok =
        target.startsWith(path.join(src, "shared") + path.sep) ||
        target.startsWith(path.join(src, "data") + path.sep);
      assert.ok(ok, `${file} imports outside shared/: ${target}`);
    }
  }
});
