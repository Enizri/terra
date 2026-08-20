// Mechanical guard for the import rules in ARCHITECTURE.md:
//   app/routes → features → shared (and data/)
// Regex over source text, not a resolver — imports here are always relative
// with explicit extensions (no path aliases), so this is exact enough.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const src = import.meta.dirname;

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));
}

function importedSpecs(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/^import[^"']*["'](\.[^"']+)["']/gm)].map((m) => m[1]);
}

function resolveImport(file: string, spec: string): string {
  return path.resolve(path.dirname(file), spec);
}

const sharedRoot = path.join(src, "shared");
const featuresRoot = path.join(src, "features");
const dataRoot = path.join(src, "data");
const routesRoot = path.join(src, "routes");
const appRoot = path.join(src, "app");

function under(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

test("routes import only themselves, features/, shared/, and data/", () => {
  for (const route of readdirSync(routesRoot)) {
    const own = path.join(routesRoot, route);
    for (const file of sourceFiles(own)) {
      for (const spec of importedSpecs(file)) {
        const target = resolveImport(file, spec);
        const ok =
          under(own, target) ||
          under(featuresRoot, target) ||
          under(sharedRoot, target) ||
          under(dataRoot, target);
        assert.ok(ok, `${file} imports outside its route: ${spec} → ${target}`);
      }
    }
  }
});

test("routes must not import each other", () => {
  for (const route of readdirSync(routesRoot)) {
    const own = path.join(routesRoot, route);
    for (const file of sourceFiles(own)) {
      for (const spec of importedSpecs(file)) {
        const target = resolveImport(file, spec);
        if (!under(routesRoot, target)) continue;
        assert.ok(
          under(own, target),
          `${file} imports another route: ${spec} → ${target}`,
        );
      }
    }
  }
});

test("shared/ never imports routes/, app/, or features/", () => {
  for (const file of sourceFiles(sharedRoot)) {
    for (const spec of importedSpecs(file)) {
      const target = resolveImport(file, spec);
      const ok = under(sharedRoot, target) || under(dataRoot, target);
      assert.ok(ok, `${file} imports outside shared/: ${spec} → ${target}`);
    }
  }
});

test("features/ never import routes/ or app/", () => {
  for (const file of sourceFiles(featuresRoot)) {
    for (const spec of importedSpecs(file)) {
      const target = resolveImport(file, spec);
      const bad = under(routesRoot, target) || under(appRoot, target);
      assert.ok(!bad, `${file} must not import routes/app: ${spec} → ${target}`);
    }
  }
});

test("app/ may import routes/, features/, shared/, data/ (not feature internals soft-check)", () => {
  for (const file of sourceFiles(appRoot)) {
    for (const spec of importedSpecs(file)) {
      const target = resolveImport(file, spec);
      const ok =
        under(appRoot, target) ||
        under(routesRoot, target) ||
        under(featuresRoot, target) ||
        under(sharedRoot, target) ||
        under(dataRoot, target);
      assert.ok(ok, `${file} imports outside app composition: ${spec} → ${target}`);
    }
  }
});

/** Soft preference: cross-feature and route→feature imports use the public index. */
test("prefer importing features via index.ts (soft)", () => {
  const warnings: string[] = [];
  const scanners = [
    ...sourceFiles(routesRoot),
    ...sourceFiles(appRoot),
    ...sourceFiles(featuresRoot),
  ];
  for (const file of scanners) {
    for (const spec of importedSpecs(file)) {
      const target = resolveImport(file, spec);
      if (!under(featuresRoot, target)) continue;
      // Same-feature relative imports (./foo) are fine.
      const fileFeature = path.relative(featuresRoot, file).split(path.sep)[0];
      const targetFeature = path.relative(featuresRoot, target).split(path.sep)[0];
      if (fileFeature && fileFeature === targetFeature && under(featuresRoot, file)) {
        continue;
      }
      const base = path.basename(target);
      const isIndex =
        base === "index.ts" ||
        base === "index.tsx" ||
        // Directory import resolves to the feature folder (index implied).
        (existsSync(path.join(target, "index.ts")) ||
          existsSync(path.join(target, "index.tsx")));
      if (!isIndex) {
        warnings.push(`${file} → ${spec}`);
      }
    }
  }
  // Soft: print but do not fail — keep CI green while nudging public APIs.
  if (warnings.length > 0) {
    console.warn(
      `prefer feature index.ts (${warnings.length}):\n` +
        warnings.map((w) => `  ${w}`).join("\n"),
    );
  }
  assert.ok(true);
});
