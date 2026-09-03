import assert from "node:assert/strict";
import test from "node:test";
import { extractGitHubURL, parseGitHubURL, discardedRefNote } from "./githubUrl.ts";

test("https github URLs normalize to canonical form", () => {
  assert.equal(
    extractGitHubURL("https://github.com/terra/terra"),
    "https://github.com/terra/terra",
  );
  assert.equal(
    extractGitHubURL("https://github.com/terra/terra.git"),
    "https://github.com/terra/terra",
  );
  assert.equal(
    extractGitHubURL("https://github.com/terra/terra/tree/main"),
    "https://github.com/terra/terra",
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

test("a /tree/<branch> URL keeps the repo and names the discarded branch", () => {
  const parsed = parseGitHubURL("https://github.com/acme/notes/tree/feature-x");
  assert.deepEqual(parsed, {
    url: "https://github.com/acme/notes",
    discardedBranch: "feature-x",
  });
  assert.equal(
    discardedRefNote(parsed!),
    "Terra maps the default branch — the URL pointed at feature-x.",
  );
});

test("a subdirectory under tree is named in the note", () => {
  const parsed = parseGitHubURL("https://github.com/acme/notes/tree/main/web");
  assert.equal(parsed?.url, "https://github.com/acme/notes");
  assert.equal(parsed?.discardedBranch, "main");
  assert.equal(parsed?.discardedPath, "web");
  assert.match(discardedRefNote(parsed!) ?? "", /main and web/);
});

test("a blob path is treated as a discarded branch plus path", () => {
  const parsed = parseGitHubURL("https://github.com/acme/notes/blob/main/README.md");
  assert.equal(parsed?.discardedBranch, "main");
  assert.equal(parsed?.discardedPath, "README.md");
});

test("a bare owner/repo has no discarded note", () => {
  const parsed = parseGitHubURL("https://github.com/acme/notes");
  assert.equal(discardedRefNote(parsed!), null);
});
