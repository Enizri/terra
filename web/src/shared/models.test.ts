import assert from "node:assert/strict";
import test from "node:test";
import { eligibility, fitNote, needsKey, type CatalogEntry, type HostCapabilities } from "./models.ts";

const small: CatalogEntry = {
  id: "local-small",
  kind: "local",
  display_name: "Small",
  tier: "fast",
  blurb: "b",
  hf_id: "org/small",
  min_ram_gb: 8,
  size_gb: 3,
};
const big: CatalogEntry = { ...small, id: "local-big", display_name: "Big", min_ram_gb: 32, size_gb: 15 };
const remote: CatalogEntry = {
  id: "openai-mini",
  kind: "remote",
  display_name: "Mini",
  tier: "balanced",
  blurb: "b",
  provider: "openai",
  base_url: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  requires_api_key: true,
};

const laptop: HostCapabilities = { ram_gb: 16, device: "mps" };
const tiny: HostCapabilities = { ram_gb: 8, device: "cpu" };
const unknown: HostCapabilities = { ram_gb: 0, device: "cpu" };

test("local models are gated on RAM, with a hint the user can act on", () => {
  assert.equal(eligibility(small, laptop).eligible, true);
  const verdict = eligibility(big, laptop);
  assert.equal(verdict.eligible, false);
  assert.match(verdict.hint, /needs ~32 GB RAM/);
  assert.match(verdict.hint, /16 GB/, "the hint names what this machine actually has");
});

test("an unknown host only clears the small weights", () => {
  assert.equal(eligibility(small, unknown).eligible, true);
  assert.equal(eligibility(big, unknown).eligible, false);
  assert.match(eligibility(big, unknown).hint, /unknown/);
  assert.equal(eligibility(small, null).eligible, true);
});

test("remote models never depend on the host", () => {
  assert.equal(eligibility(remote, tiny).eligible, true);
  assert.equal(eligibility(remote, null).eligible, true);
});

test("fitNote says where a model runs and what it costs", () => {
  assert.match(fitNote(small, laptop), /Runs here on mps/);
  assert.match(fitNote(small, laptop), /3 GB download/);
  assert.match(fitNote(remote, laptop), /openai/);
  assert.match(fitNote(remote, laptop), /API key/);
});

test("needsKey is true only for a BYOK model with nothing stored", () => {
  assert.equal(needsKey(remote, ""), true);
  assert.equal(needsKey(remote, "   "), true);
  assert.equal(needsKey(remote, "sk-stored"), false);
  assert.equal(needsKey(small, ""), false);
});
