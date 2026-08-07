import assert from "node:assert/strict";
import test from "node:test";
import { tracesURL } from "./tracesUrl.ts";

test("tracesURL encodes repo and omits token when empty", () => {
  assert.equal(
    tracesURL("https://github.com/acme/notes", ""),
    "/traces?repo_url=https%3A%2F%2Fgithub.com%2Facme%2Fnotes",
  );
});

test("tracesURL adds query token for EventSource auth fallback", () => {
  // EventSource cannot set Authorization; server accepts ?token= on GET /traces.
  const url = tracesURL("https://github.com/acme/notes", "secret");
  assert.equal(
    url,
    "/traces?repo_url=https%3A%2F%2Fgithub.com%2Facme%2Fnotes&token=secret",
  );
});
