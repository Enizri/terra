package server

import (
	"crypto/subtle"
	"net"
	"net/http"
	"strings"

	"github.com/Enizri/terra/backend/api/internal/trace"
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

// withToken gates expensive/mutating routes when want (Cfg.Token) is set.
// Empty token leaves the API open (local make dev).
func withToken(want string, next http.Handler) http.Handler {
	if want == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !requiresToken(r) {
			next.ServeHTTP(w, r)
			return
		}
		// The preview trace hook runs inside untrusted repos, so it gets the
		// scoped ingest token, never the real API token.
		if r.Method == http.MethodPost && r.URL.Path == "/traces/ingest" && tokenMatches(r, trace.IngestToken()) {
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

// requiresToken lists the gated routes. GET /models and GET /host/capabilities
// are deliberately absent: both return constants about this binary and this
// machine, not repo data, so they sit with /healthz on the open side.
func requiresToken(r *http.Request) bool {
	p := r.URL.Path
	switch r.Method {
	case http.MethodPost:
		switch p {
		case "/analyze", "/ask", "/traces/ingest":
			return true
		}
		if strings.HasPrefix(p, "/jobs/") || strings.HasPrefix(p, "/preview") {
			return true
		}
	case http.MethodDelete:
		if strings.HasPrefix(p, "/analyses/") {
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
	if c, err := r.Cookie(accessCookie); err == nil && c.Value != "" {
		return subtle.ConstantTimeCompare([]byte(c.Value), []byte(want)) == 1
	}
	// Query ?token= is only for EventSource/SSE: browsers cannot set Authorization
	// (or any custom header) on EventSource, so GET /traces uses this fallback.
	if r.Method == http.MethodGet {
		got := r.URL.Query().Get("token")
		return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
	}
	return false
}

const accessCookie = "terra_token"

// grantAccessCookie lets the workspace load without a paste-token panel.
// Same-origin fetch and EventSource send it automatically.
func grantAccessCookie(w http.ResponseWriter, token string) {
	if token == "" {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     accessCookie,
		Value:    token,
		Path:     "/",
		SameSite: http.SameSiteLaxMode,
		HttpOnly: true,
	})
}
