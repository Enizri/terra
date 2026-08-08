package preview

import (
	"net/http"
	"strings"
	"time"

	"github.com/Enizri/terra/internal/trace"
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
		if !trace.WorthKeeping(appPath) {
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

// Flush keeps the recorder transparent for streaming responses (Vite HMR,
// SSE endpoints inside previewed apps).
func (rec *statusRecorder) Flush() {
	if flusher, ok := rec.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// Unwrap lets http.ResponseController reach the underlying writer so the
// reverse proxy can hijack the connection for WebSocket (101) upgrades.
func (rec *statusRecorder) Unwrap() http.ResponseWriter {
	return rec.ResponseWriter
}
