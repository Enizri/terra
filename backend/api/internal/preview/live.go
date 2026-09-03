package preview

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

// live is the process-wide path-based preview proxy hub (/__live/{id}/...).
var live = &liveHub{byID: map[string]http.Handler{}}

type liveHub struct {
	mu   sync.Mutex
	byID map[string]http.Handler
}

// LiveHandler serves mounted path proxies under /__live/{id}/...
// Register on the main API mux before the SPA catch-all; leave ungated so iframes work.
func LiveHandler() http.Handler { return live }

func (h *liveHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/__live/")
	if rest == r.URL.Path {
		http.NotFound(w, r)
		return
	}
	id, _, _ := strings.Cut(rest, "/")
	if id == "" {
		http.NotFound(w, r)
		return
	}
	h.mu.Lock()
	handler := h.byID[id]
	h.mu.Unlock()
	if handler == nil {
		http.NotFound(w, r)
		return
	}
	// Keep the full /__live/{id}/... path — Vite is started with matching --base.
	handler.ServeHTTP(w, r)
}

// MountPathProxy mounts a reverse proxy at /__live/{id}/ and returns the
// public URL under publicBase (config.PublicURL).
func MountPathProxy(publicBase, id, targetBaseURL, repoKey string, authFix func(*http.Request)) (publicURL string, err error) {
	id = strings.Trim(id, "/")
	if id == "" || strings.Contains(id, "/") {
		return "", fmt.Errorf("invalid live proxy id %q", id)
	}
	if _, err := url.ParseRequestURI(strings.TrimRight(targetBaseURL, "/") + "/"); err != nil {
		return "", fmt.Errorf("invalid preview target: %w", err)
	}
	return mountPathProxy(publicBase, id, targetBaseURL, repoKey, authFix, false)
}

func mountPathProxy(publicBase, id, targetBaseURL, repoKey string, authFix func(*http.Request), stripPrefix bool) (publicURL string, err error) {
	id = strings.Trim(id, "/")
	if id == "" || strings.Contains(id, "/") {
		return "", fmt.Errorf("invalid live proxy id %q", id)
	}
	if _, err := url.ParseRequestURI(strings.TrimRight(targetBaseURL, "/") + "/"); err != nil {
		return "", fmt.Errorf("invalid preview target: %w", err)
	}
	prefix := "/__live/" + id
	handler, err := newInjectProxy(repoKey, targetBaseURL, authFix, prefix, stripPrefix)
	if err != nil {
		return "", err
	}
	live.mu.Lock()
	live.byID[id] = handler
	live.mu.Unlock()
	return strings.TrimRight(publicBase, "/") + prefix + "/", nil
}

// UnmountPathProxy removes a previously mounted /__live/{id}/ proxy.
func UnmountPathProxy(id string) {
	id = strings.Trim(id, "/")
	live.mu.Lock()
	delete(live.byID, id)
	live.mu.Unlock()
}
