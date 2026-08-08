import assert from "node:assert/strict";
import test from "node:test";
import { extractGitHubURL } from "./githubUrl.ts";

test("https github URLs normalize to canonical form", () => {
  assert.equal(
    extractGitHubURL("https://github.com/usememos/memos"),
    "https://github.com/usememos/memos",
  );
  assert.equal(
    extractGitHubURL("https://github.com/usememos/memos.git"),
    "https://github.com/usememos/memos",
  );
  assert.equal(
    extractGitHubURL("https://github.com/usememos/memos/tree/main"),
    "https://github.com/usememos/memos",
  );
});

test("bare and ssh-ish github.com forms work", () => {
  assert.equal(
    extractGitHubURL("github.com/acme/notes"),
    "https://github.com/acme/notes",
  );
  assert.equal(
    extractGitHubURL("www.github.com/acme/notes"),
    "https://github.com/acme/notes",
  );
});

test("uri-list comments are skipped", () => {
  assert.equal(
    extractGitHubURL("# comment\nhttps://github.com/acme/notes\n"),
    "https://github.com/acme/notes",
  );
});

test("non-github text returns null", () => {
  assert.equal(extractGitHubURL("https://gitlab.com/acme/notes"), null);
  assert.equal(extractGitHubURL("not a url"), null);
  assert.equal(extractGitHubURL(""), null);
});

test("first github URL wins when text has extras", () => {
  assert.equal(
    extractGitHubURL("check https://github.com/acme/notes please"),
    "https://github.com/acme/notes",
  );
});
