package preview

import (
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/Enizri/terra/internal/trace"
)

// traceMiddleware publishes one span per proxied request that looks like the
// app doing something (API calls, navigations) rather than the dev server
// shipping assets.
func traceMiddleware(repo string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !traceworthy(r.URL.Path) {
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
		})
	})
}

// assetExts is dev-server noise: shipping these is not the app acting.
var assetExts = map[string]bool{
	".js": true, ".mjs": true, ".ts": true, ".tsx": true, ".jsx": true,
	".css": true, ".map": true, ".svg": true, ".png": true, ".jpg": true,
	".jpeg": true, ".gif": true, ".webp": true, ".ico": true,
	".woff": true, ".woff2": true, ".ttf": true, ".otf": true,
}

// traceworthy filters the proxy stream down to requests worth lighting up
// on the map. RPC paths with dots (memos.api.v1.MemoService/...) survive:
// only known asset extensions are dropped, not "has a dot".
func traceworthy(p string) bool {
	for _, prefix := range []string{"/__terra/", "/@", "/node_modules/", "/src/", "/assets/"} {
		if strings.HasPrefix(p, prefix) {
			return false
		}
	}
	if strings.Contains(p, "hot-update") {
		return false
	}
	return !assetExts[strings.ToLower(path.Ext(p))]
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// Flush keeps the recorder transparent for streaming responses (Vite HMR,
// SSE endpoints inside previewed apps).
func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
