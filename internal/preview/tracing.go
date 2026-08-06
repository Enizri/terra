package preview

import (
	"net/http"
	"time"

	"github.com/Enizri/terra/internal/trace"
)

// traceMiddleware publishes one span per proxied request that looks like the
// app doing something (API calls, navigations) rather than the dev server
// shipping assets.
func traceMiddleware(repo string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !trace.WorthKeeping(r.URL.Path) {
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
			Path:   r.URL.Path,
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
