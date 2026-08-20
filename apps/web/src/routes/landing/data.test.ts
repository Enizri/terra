import assert from "node:assert/strict";
import test from "node:test";
import { copy, users } from "./data.ts";

test("playground copy sells live collaboration, not inference plumbing", () => {
  const collaborate = copy.ops.find((o) => o.id === "collaborate")!.caption;
  assert.match(collaborate, /live software/);
  assert.match(collaborate, /same repo/);
  assert.doesNotMatch(collaborate, /openai|endpoint/i);
});

test("the collaboration demo uses the approved cast", () => {
  assert.deepEqual(
    users.map(({ id, name, photo, color }) => ({ id, name, photo, ring: color.ring })),
    [
      { id: "1", name: "Evyatar", photo: "/terra/images/collaborator-evyatar", ring: "ring-amber" },
      { id: "2", name: "Maya", photo: "/terra/images/collaborator-maya", ring: "ring-indigo" },
      { id: "3", name: "Leo", photo: "/terra/images/collaborator-leo", ring: "ring-green" },
    ],
  );
});
