import assert from "node:assert/strict";
import test from "node:test";
import { matchSpan, pathTokens, topLevelId } from "./spanMatch.ts";
import type { Component, TerraMap } from "./types.ts";
import memos from "../../data/memos.map.json" with { type: "json" };

const components = (memos as TerraMap).components;

test("tokenizes REST and RPC paths, dropping plumbing", () => {
  assert.deepEqual(pathTokens("/api/v1/memos"), ["memos"]);
  // RPC package prefix is app-wide noise; the *Service token is the route.
  assert.deepEqual(pathTokens("/memos.api.v1.MemoService/CreateMemo"), ["memo", "creatememo"]);
});

test("maps memos API paths onto golden-map components", () => {
  assert.equal(matchSpan("/api/v1/memos", components), "memos");
  assert.equal(matchSpan("/api/v1/attachments", components), "attachments");
  assert.equal(matchSpan("/memos.api.v1.AuthService/SignIn", components), "auth");
});

test("navigations and unknowns stay quiet", () => {
  assert.equal(matchSpan("/", components), null);
  assert.equal(matchSpan("/favicon-route", components), null);
});

test("file segments count as evidence", () => {
  const list: Component[] = [
    {
      id: "billing",
      parent_id: null,
      name: "Billing",
      purpose: "",
      importance: "high",
      type: "backend",
      files: ["server/invoices/handler.go"],
    },
  ];
  assert.equal(matchSpan("/invoices/42", list), "billing");
});

test("child hits pulse the top-level card", () => {
  assert.equal(topLevelId("data.drivers"), "data");
  assert.equal(topLevelId("web"), "web");
});
