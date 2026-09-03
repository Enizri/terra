import assert from "node:assert/strict";
import test from "node:test";
import { askEvents } from "./api.ts";

test("askEvents posts /jobs/agent and drives from job events", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "/jobs/agent") {
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(body.question, "How does SSO work?");
      return new Response(JSON.stringify({ job_id: "job-agent" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "/jobs/job-agent/events") {
      const ndjson = [
        '{"stage":"ask","label":"Terra is reading the selection"}',
        '{"stage":"retrieve","label":"lookup_component"}',
        '{"stage":"tool","label":"read_snippet"}',
        '{"stage":"done","answer":"auth owns SSO"}',
      ].join("\n") + "\n";
      return new Response(ndjson, {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }
    return new Response("missing", { status: 404 });
  };
  try {
    const stages: string[] = [];
    let answer = "";
    for await (const ev of askEvents("https://github.com/acme/notes", "How does SSO work?", [])) {
      stages.push(ev.stage);
      if (ev.stage === "done") answer = ev.answer ?? "";
    }
    assert.equal(calls[0], "POST /jobs/agent");
    assert.ok(calls.some((c) => c.includes("/jobs/job-agent/events")));
    assert.deepEqual(stages, ["ask", "retrieve", "tool", "done"]);
    assert.equal(answer, "auth owns SSO");
  } finally {
    globalThis.fetch = original;
  }
});
