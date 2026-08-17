import assert from "node:assert/strict";
import test from "node:test";
import { apiKeyStorageKey, clearApiKey, getApiKey, isAuthFailure, setApiKey } from "./modelKeys.ts";

/** node:test has no DOM; a Map stands in for localStorage. */
function fakeStorage(): Record<string, string> {
  const store: Record<string, string> = {};
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
  return store;
}

test("keys are namespaced per provider", () => {
  assert.equal(apiKeyStorageKey("openai"), "terra_key_openai");
  assert.notEqual(apiKeyStorageKey("openai"), apiKeyStorageKey("groq"));
});

test("set/get/clear round-trip and never cross providers", () => {
  fakeStorage();
  setApiKey("openai", "  sk-openai  ");
  setApiKey("groq", "gsk-groq");
  assert.equal(getApiKey("openai"), "sk-openai", "the key is trimmed on the way in");
  assert.equal(getApiKey("groq"), "gsk-groq");

  clearApiKey("openai");
  assert.equal(getApiKey("openai"), "");
  assert.equal(getApiKey("groq"), "gsk-groq", "clearing one provider must not touch another");
});

test("a blank key clears rather than storing whitespace", () => {
  const store = fakeStorage();
  setApiKey("openai", "sk-real");
  setApiKey("openai", "   ");
  assert.equal(getApiKey("openai"), "");
  assert.equal(Object.keys(store).length, 0);
});

test("an empty provider is a no-op, not a global key", () => {
  const store = fakeStorage();
  setApiKey("", "sk-oops");
  assert.deepEqual(store, {});
  assert.equal(getApiKey(""), "");
});

test("unavailable storage degrades to no key instead of throwing", () => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
    removeItem() {
      throw new Error("denied");
    },
  };
  assert.equal(getApiKey("openai"), "");
  assert.doesNotThrow(() => setApiKey("openai", "sk-x"));
  assert.doesNotThrow(() => clearApiKey("openai"));
});

test("isAuthFailure spots a rejected key and ignores other failures", () => {
  for (const message of [
    "llm provider 401 at https://api.openai.com/v1 (model gpt-4.1): bad key",
    "llm provider 403 at https://api.groq.com/openai/v1: forbidden",
    "Incorrect API key provided",
    "unauthorized",
  ]) {
    assert.ok(isAuthFailure(message), `should be an auth failure: ${message}`);
  }
  for (const message of [
    "llm provider 429 at https://api.openai.com/v1: rate limited",
    "cannot reach the analyzer service",
    "analyze exceeded the 15m0s limit",
  ]) {
    assert.ok(!isAuthFailure(message), `should not be an auth failure: ${message}`);
  }
});
