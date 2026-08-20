import assert from "node:assert/strict";
import test from "node:test";
import { analyzeBody } from "./models.ts";

test("an unrouted analyze sends exactly the pre-picker body", () => {
  assert.deepEqual(analyzeBody({ repoUrl: "https://github.com/acme/notes" }), {
    repo_url: "https://github.com/acme/notes",
  });
});

test("only the fields the user actually chose go on the wire", () => {
  assert.deepEqual(
    analyzeBody({
      repoUrl: "https://github.com/acme/notes",
      probeId: "abc",
      modelId: "local-qwen2.5-1.5b",
      apiKey: "",
    }),
    {
      repo_url: "https://github.com/acme/notes",
      probe_id: "abc",
      model_id: "local-qwen2.5-1.5b",
    },
  );
});

test("a whitespace-only key is dropped, not sent", () => {
  const body = analyzeBody({
    repoUrl: "https://github.com/acme/notes",
    modelId: "openai-gpt-5.4",
    apiKey: "   ",
  });
  assert.ok(!("api_key" in body));
});

test("a real key is trimmed and forwarded", () => {
  const body = analyzeBody({
    repoUrl: "https://github.com/acme/notes",
    modelId: "openai-gpt-5.4",
    apiKey: "  sk-live  ",
  });
  assert.equal(body.api_key, "sk-live");
});
