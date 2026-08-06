// Terra trace hook — preloaded into a previewed app's Node processes via
// NODE_OPTIONS=--require. Watches requests the app serves (http.Server) and
// requests it makes (fetch, http/https.request) and reports them to Terra's
// ingest endpoint, so the map can animate the whole path of a request, not
// just the edge the proxy sees.
//
// Plain CommonJS, zero dependencies, and it must never crash the host app:
// every patch is wrapped in try/catch and any failure degrades to "no spans".
"use strict";

try {
  const http = require("http");
  const https = require("https");
  const { URL } = require("url");

  const INGEST = process.env.TERRA_TRACE_URL || "";
  const REPO = process.env.TERRA_TRACE_REPO || "";
  // The header that marks the hook's own ingest POSTs so the client patches
  // skip them — belt to the URL check's suspenders, no feedback loop either way.
  const INTERNAL_HEADER = "x-terra-trace-internal";

  if (INGEST && REPO) {
    const ingestURL = new URL(INGEST);

    /* ---------- batching ---------- */

    let queue = [];
    let timer = null;

    function flush() {
      timer = null;
      if (queue.length === 0) return;
      const batch = queue;
      queue = [];
      try {
        const body = JSON.stringify({ repo_url: REPO, spans: batch });
        // http.request directly (not fetch): fetch would recurse through its
        // own patch, and the header marks it for the http.request patch.
        const req = http.request(
          {
            hostname: ingestURL.hostname,
            port: ingestURL.port,
            path: ingestURL.pathname,
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
              [INTERNAL_HEADER]: "1",
            },
          },
          (res) => res.resume() // drain; fire-and-forget
        );
        req.on("error", () => {}); // Terra gone? spans just stop.
        req.end(body);
      } catch (e) {
        // Never let telemetry take the app down.
      }
    }

    function push(span) {
      queue.push(span);
      if (queue.length >= 20) {
        if (timer) clearTimeout(timer);
        flush();
        return;
      }
      if (!timer) {
        timer = setTimeout(flush, 500);
        // A pending flush must not keep the process alive.
        if (timer.unref) timer.unref();
      }
    }

    /* ---------- helpers ---------- */

    function isInternal(headers, host, path) {
      if (headers && (headers[INTERNAL_HEADER] || headers[INTERNAL_HEADER.toUpperCase()])) return true;
      // Anything aimed at the ingest endpoint itself is ours (or a loop).
      return host === ingestURL.host && path === ingestURL.pathname;
    }

    // Best-effort target of an http.request/https.request call: handles
    // (url[, options]) and (options) shapes. Null when unparseable — skip.
    function targetOf(a, b, defaultProto) {
      let url = null;
      let opts = null;
      if (typeof a === "string") url = new URL(a);
      else if (a instanceof URL) url = a;
      else if (a && typeof a === "object") opts = a;
      if (b && typeof b === "object" && typeof b !== "function") opts = b;
      if (url) {
        return {
          method: ((opts && opts.method) || "GET").toUpperCase(),
          host: url.host,
          path: url.pathname,
          headers: (opts && opts.headers) || null,
        };
      }
      if (!opts) return null;
      const host =
        (opts.host || opts.hostname || "localhost") + (opts.port ? ":" + opts.port : "");
      const path = String(opts.path || "/").split("?")[0];
      return {
        method: (opts.method || "GET").toUpperCase(),
        host: host,
        path: path,
        headers: opts.headers || null,
        proto: defaultProto,
      };
    }

    function clientSpan(target, status, start) {
      push({
        kind: "client",
        method: target.method,
        // Host prefixed so the map can tell the app's own API from third
        // parties; spanMatch tokenizes it away either way.
        path: target.host + target.path,
        status: status,
        dur_ms: Date.now() - start,
      });
    }

    /* ---------- incoming: http.Server ---------- */

    try {
      const origEmit = http.Server.prototype.emit;
      http.Server.prototype.emit = function (ev, req, res) {
        if (ev === "request" && req && res && typeof res.once === "function") {
          try {
            const start = Date.now();
            res.once("finish", () => {
              try {
                push({
                  kind: "server",
                  method: req.method || "GET",
                  path: String(req.url || "/").split("?")[0],
                  status: res.statusCode || 0,
                  dur_ms: Date.now() - start,
                });
              } catch (e) {}
            });
          } catch (e) {}
        }
        return origEmit.apply(this, arguments);
      };
    } catch (e) {}

    /* ---------- outgoing: http/https.request ---------- */

    function patchRequest(mod, name, defaultProto) {
      try {
        const orig = mod[name];
        mod[name] = function (a, b, c) {
          let target = null;
          try {
            target = targetOf(a, b, defaultProto);
          } catch (e) {}
          const req = orig.apply(this, arguments);
          try {
            if (target && !isInternal(target.headers, target.host, target.path)) {
              const start = Date.now();
              req.on("response", (res) => clientSpan(target, res.statusCode || 0, start));
            }
          } catch (e) {}
          return req;
        };
      } catch (e) {}
    }

    // http.get calls its module-internal request, not the patched export, so
    // both entry points need their own wrap.
    patchRequest(http, "request", "http:");
    patchRequest(http, "get", "http:");
    patchRequest(https, "request", "https:");
    patchRequest(https, "get", "https:");

    /* ---------- outgoing: global fetch ---------- */

    try {
      if (typeof globalThis.fetch === "function") {
        const origFetch = globalThis.fetch;
        globalThis.fetch = function (input, init) {
          let target = null;
          try {
            const u = new URL(
              typeof input === "string" || input instanceof URL ? input : input.url,
              "http://localhost/"
            );
            target = {
              method: ((init && init.method) || (input && input.method) || "GET").toUpperCase(),
              host: u.host,
              path: u.pathname,
            };
            if (isInternal(null, target.host, target.path)) target = null;
          } catch (e) {}
          const p = origFetch.apply(this, arguments);
          if (target) {
            const start = Date.now();
            // Both handlers attach to a derived promise, so a rejection here
            // is observed and the caller's own handling is untouched.
            p.then(
              (res) => clientSpan(target, res.status || 0, start),
              () => clientSpan(target, 0, start)
            );
          }
          return p;
        };
      }
    } catch (e) {}
  }
} catch (e) {
  // Tracing is optional; the previewed app is not.
}
