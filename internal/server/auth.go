package server

import (
	"crypto/subtle"
	"net"
	"net/http"
	"os"
	"strings"
)

// LoopbackAddr reports whether a listen address can only be reached from this
// machine. Empty or unparseable hosts fail closed: ":8080" binds every
// interface.
func LoopbackAddr(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil || host == "" {
		return false
	}
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// withToken gates expensive/mutating routes when TERRA_TOKEN is set.
// Empty TERRA_TOKEN leaves the API open (local make dev).
func withToken(next http.Handler) http.Handler {
	want := strings.TrimSpace(os.Getenv("TERRA_TOKEN"))
	if want == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !requiresToken(r) {
			next.ServeHTTP(w, r)
			return
		}
		if !tokenMatches(r, want) {
			httpError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requiresToken(r *http.Request) bool {
	p := r.URL.Path
	switch r.Method {
	case http.MethodPost:
		switch p {
		case "/analyze", "/preview", "/ask", "/traces/ingest":
			return true
		}
		if strings.HasPrefix(p, "/jobs/") {
			return true
		}
	case http.MethodGet:
		switch p {
		case "/files", "/traces", "/analyses":
			return true
		}
		if strings.HasPrefix(p, "/jobs/") || strings.HasPrefix(p, "/analyses/") {
			return true
		}
	}
	return false
}

func tokenMatches(r *http.Request, want string) bool {
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		got := strings.TrimPrefix(auth, "Bearer ")
		return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
	}
	if got := r.Header.Get("X-Terra-Token"); got != "" {
		return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
	}
	// Query ?token= is only for EventSource/SSE: browsers cannot set Authorization
	// (or any custom header) on EventSource, so GET /traces uses this fallback.
	if r.Method == http.MethodGet {
		got := r.URL.Query().Get("token")
		return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
	}
	return false
}
