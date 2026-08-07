// Trace hook via NODE_OPTIONS=--require. Must never crash the host app.
"use strict";

try {
  const http = require("http");
  const https = require("https");
  const { URL } = require("url");

  const INGEST = process.env.TERRA_TRACE_URL || "";
  const REPO = process.env.TERRA_TRACE_REPO || "";
  const TRACE_TOKEN = process.env.TERRA_TRACE_TOKEN || "";
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
        const headers = {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          [INTERNAL_HEADER]: "1",
        };
        if (TRACE_TOKEN) {
          headers.authorization = "Bearer " + TRACE_TOKEN;
        }
        // Prefer http.request over fetch to avoid recursive patches.
        const req = http.request(
          {
            hostname: ingestURL.hostname,
            port: ingestURL.port,
            path: ingestURL.pathname,
            method: "POST",
            headers: headers,
          },
          (res) => res.resume()
        );
        req.on("error", () => {});
        req.end(body);
      } catch (e) {
        // ignore
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
        if (timer.unref) timer.unref();
      }
    }

    /* ---------- helpers ---------- */

    function isInternal(headers, host, path) {
      if (headers && (headers[INTERNAL_HEADER] || headers[INTERNAL_HEADER.toUpperCase()])) return true;
      return host === ingestURL.host && path === ingestURL.pathname;
    }

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
      let host = String(opts.host || opts.hostname || "localhost");
      if (opts.port && !host.includes(":")) host += ":" + opts.port;
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

    // Patch get and request; http.get does not use the patched request export.
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
  // ignore
}
