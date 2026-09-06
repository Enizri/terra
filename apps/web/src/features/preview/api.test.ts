import assert from "node:assert/strict";
import test from "node:test";
import { previewCLIEvents, previewEvents, previewProbe, previewRoutes, previewTestEvents, repoReadme } from "./api.ts";

test("previewEvents posts /jobs/preview and drives from job events", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "/jobs/preview") {
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(body.repo_url, "https://github.com/acme/notes");
      return new Response(JSON.stringify({ job_id: "job-preview" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "/jobs/job-preview/events") {
      const ndjson =
        [
          '{"stage":"checkout","label":"Fetching the repository"}',
          '{"stage":"detect","label":"Finding apps"}',
          '{"stage":"ready","label":"http://preview.test/","preview":{"url":"http://preview.test/","primary_id":"web","apps":[{"id":"web","name":"web","kind":"web","framework":"vite","url":"http://preview.test/","status":"ready"}]}}',
          '{"stage":"done","answer":"http://preview.test/"}',
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
    let url = "";
    for await (const ev of previewEvents("https://github.com/acme/notes")) {
      stages.push(ev.stage);
      if (ev.preview?.url) url = ev.preview.url;
    }
    assert.equal(calls[0], "POST /jobs/preview");
    assert.ok(calls.some((c) => c.includes("/jobs/job-preview/events")));
    assert.deepEqual(stages, ["checkout", "detect", "ready", "done"]);
    assert.equal(url, "http://preview.test/");
  } finally {
    globalThis.fetch = original;
  }
});

test("previewTestEvents posts /jobs/preview/test", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    if (url === "/jobs/preview/test") {
      return new Response(JSON.stringify({ job_id: "job-test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "/jobs/job-test/events") {
      return new Response('{"stage":"done","label":"ok"}\n', {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }
    return new Response("missing", { status: 404 });
  };
  try {
    const stages: string[] = [];
    for await (const ev of previewTestEvents("https://github.com/acme/lib")) {
      stages.push(ev.stage);
    }
    assert.deepEqual(stages, ["done"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("previewCLIEvents posts /jobs/preview/cli", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "/jobs/preview/cli") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(body.args, "map gh");
      return new Response(JSON.stringify({ job_id: "job-cli" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "/jobs/job-cli/events") {
      return new Response('{"stage":"done","label":"usage"}\n', {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }
    return new Response("missing", { status: 404 });
  };
  try {
    const stages: string[] = [];
    for await (const ev of previewCLIEvents("https://github.com/acme/cli", "map gh")) {
      stages.push(ev.stage);
    }
    assert.deepEqual(stages, ["done"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("previewRoutes and previewProbe hit the API console endpoints", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/preview/routes?")) {
      return new Response(JSON.stringify({ routes: ["/", "/healthz"] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "/preview/probe") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(body.path, "/healthz");
      return new Response(JSON.stringify({ method: "GET", path: "/healthz", status: 200, body: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("missing", { status: 404 });
  };
  try {
    assert.deepEqual(await previewRoutes("https://github.com/acme/api"), ["/", "/healthz"]);
    const hit = await previewProbe("https://github.com/acme/api", "http://127.0.0.1:8080/__live/x/", "GET", "/healthz");
    assert.equal(hit.status, 200);
  } finally {
    globalThis.fetch = original;
  }
});

test("repoReadme tries README.md first", async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = new URL(String(input), "http://local.test");
    paths.push(url.searchParams.get("path") ?? "");
    return new Response(JSON.stringify({ path: "README.md", content: "# Lib" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const text = await repoReadme("https://github.com/acme/lib");
    assert.equal(text, "# Lib");
    assert.equal(paths[0], "README.md");
  } finally {
    globalThis.fetch = original;
  }
});
