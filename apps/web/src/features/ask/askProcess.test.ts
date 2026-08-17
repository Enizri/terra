import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProcess,
  advanceProcess,
  completeProcess,
  updateTerraParts,
  hasMeaningfulSelection,
  type AskMessage,
} from "./askProcess.ts";

test("buildProcess skips the files step without a selection", () => {
  assert.deepEqual(
    buildProcess(false).map((s) => s.status),
    ["active", "skipped", "pending"],
  );
  assert.deepEqual(
    buildProcess(true).map((s) => s.status),
    ["active", "pending", "pending"],
  );
});

test("advanceProcess walks active → done and lights the next pending", () => {
  let steps = buildProcess(true);
  steps = advanceProcess(steps);
  assert.deepEqual(steps.map((s) => s.status), ["done", "active", "pending"]);
  steps = advanceProcess(steps);
  assert.deepEqual(steps.map((s) => s.status), ["done", "done", "active"]);
  // Last active finishes; nothing pending remains — further ticks are no-ops
  // once nothing is active.
  steps = advanceProcess(steps);
  assert.deepEqual(steps.map((s) => s.status), ["done", "done", "done"]);
  assert.deepEqual(advanceProcess(steps), steps);
});

test("advanceProcess hops over a skipped step", () => {
  const steps = advanceProcess(buildProcess(false));
  assert.deepEqual(steps.map((s) => s.status), ["done", "skipped", "active"]);
});

test("completeProcess finishes everything but leaves skipped alone", () => {
  const steps = completeProcess(buildProcess(false));
  assert.deepEqual(steps.map((s) => s.status), ["done", "skipped", "done"]);
});

test("updateTerraParts touches only the addressed message", () => {
  const msgs: AskMessage[] = [
    { role: "user", parts: [{ type: "text", text: "q" }] },
    { role: "terra", parts: [{ type: "text", text: "a" }] },
  ];
  const next = updateTerraParts(msgs, 1, (parts) => [
    ...parts,
    { type: "text", text: "more" },
  ]);
  assert.equal(next[0], msgs[0]);
  assert.equal(next[1].parts.length, 2);
});

test("hasMeaningfulSelection ignores empty objects", () => {
  assert.equal(hasMeaningfulSelection(undefined, undefined), false);
  assert.equal(hasMeaningfulSelection({}), false);
  assert.equal(hasMeaningfulSelection({ name: "x" }), true);
  assert.equal(hasMeaningfulSelection(undefined, [{}]), false);
  assert.equal(hasMeaningfulSelection({}, [{ name: "x" }]), true);
});
