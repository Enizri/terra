package preview

import (
	"bufio"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/Enizri/terra/backend/api/internal/trace"
)

// traceMiddleware publishes one span per proxied request that looks like the
// app doing something (API calls, navigations) rather than the dev server
// shipping assets. prefix is the public mount ("/__live/{id}" for the path
// proxy, "" for the loopback proxy) and is stripped before filtering — the
// asset filter's anchored prefixes (/@, /src/, ...) never match otherwise.
func traceMiddleware(repo, prefix string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		appPath := r.URL.Path
		if prefix != "" {
			appPath = strings.TrimPrefix(appPath, prefix)
			if appPath == "" {
				appPath = "/"
			}
		}
		// Protocol upgrades (Vite HMR WebSocket on "/") must not be wrapped:
		// after a 101 there is no meaningful status to record, and any
		// recorder that fails to expose Hijack breaks the reverse proxy.
		if !trace.WorthKeeping(appPath) || r.Header.Get("Upgrade") != "" {
			next.ServeHTTP(w, r)
			return
		}
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		next.ServeHTTP(rec, r)
		trace.Publish(trace.Span{
			Repo:   repo,
			Time:   start,
			Method: r.Method,
			Path:   appPath,
			Status: rec.status,
			DurMS:  time.Since(start).Milliseconds(),
			Kind:   "edge",
		})
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (rec *statusRecorder) WriteHeader(code int) {
	rec.status = code
	rec.ResponseWriter.WriteHeader(code)
}

// Flush keeps the recorder transparent for streaming responses (SSE
// endpoints inside previewed apps).
func (rec *statusRecorder) Flush() {
	if flusher, ok := rec.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// Hijack delegates so httputil.ReverseProxy can complete WebSocket upgrades
// even if a caller forgot to skip Upgrade requests above.
func (rec *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := rec.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hj.Hijack()
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (rec *statusRecorder) Unwrap() http.ResponseWriter {
	return rec.ResponseWriter
}
