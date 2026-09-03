package preview

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
)

const probeBodyCap = 8 << 10

// ProbeHit is one request Terra made against a mounted /__live/{id}/ app.
type ProbeHit struct {
	Method string `json:"method"`
	Path   string `json:"path"`
	Status int    `json:"status"`
	Body   string `json:"body"`
}

// LiveID pulls the /__live/{id} mount out of a public preview URL.
func LiveID(publicURL string) (string, bool) {
	u, err := url.Parse(publicURL)
	if err != nil || u.Path == "" {
		return "", false
	}
	rest := strings.TrimPrefix(u.Path, "/__live/")
	if rest == u.Path {
		return "", false
	}
	id, _, _ := strings.Cut(rest, "/")
	id = strings.Trim(id, "/")
	return id, id != "" && !strings.Contains(id, "/")
}

// SafeAPIPath is a same-origin path: leading slash, no traversal.
func SafeAPIPath(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		p = "/"
	}
	if !strings.HasPrefix(p, "/") || strings.Contains(p, "//") || strings.Contains(p, "..") ||
		strings.ContainsAny(p, "\\ \t\n") || strings.Contains(p, "://") || len(p) > 256 {
		return "", fmt.Errorf("path must be a single URL path on this API")
	}
	return p, nil
}

// ProbeLive GETs or POSTs path on a mounted live preview. It never leaves
// this process — the live hub is invoked in-memory.
func ProbeLive(id, method, path string) (ProbeHit, error) {
	switch method {
	case http.MethodGet, http.MethodPost:
	default:
		return ProbeHit{}, fmt.Errorf("method must be GET or POST")
	}
	path, err := SafeAPIPath(path)
	if err != nil {
		return ProbeHit{}, err
	}
	if id == "" {
		return ProbeHit{}, fmt.Errorf("missing live preview id")
	}
	req := httptest.NewRequest(method, "/__live/"+id+path, nil)
	rec := httptest.NewRecorder()
	live.ServeHTTP(rec, req)
	body := rec.Body.Bytes()
	if len(body) > probeBodyCap {
		body = append([]byte{}, body[:probeBodyCap]...)
	}
	return ProbeHit{Method: method, Path: path, Status: rec.Code, Body: string(body)}, nil
}
