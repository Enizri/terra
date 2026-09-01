import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the shipped celestial globe contains only the painted sphere", () => {
  const bytes = readFileSync(
    new URL("../../../public/terra/models/celestial-globe-sphere.glb", import.meta.url),
  );
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));

  assert.equal(json.meshes.length, 1);
  assert.equal(json.materials.length, 1);
  assert.equal(json.materials[0].name, "sphere.001");
  assert.equal(json.textures.length, 2);
  assert.doesNotMatch(JSON.stringify(json), /leg|ring|support|tablet|table/i);
});
