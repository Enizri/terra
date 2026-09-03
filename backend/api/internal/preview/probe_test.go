package preview

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestLiveID(t *testing.T) {
	id, ok := LiveID("http://127.0.0.1:8080/__live/acme-notes/")
	if !ok || id != "acme-notes" {
		t.Fatalf("got %q %v", id, ok)
	}
	if _, ok := LiveID("http://127.0.0.1:8080/preview"); ok {
		t.Fatal("non-live URL")
	}
}

func TestSafeAPIPath(t *testing.T) {
	if _, err := SafeAPIPath("/healthz"); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"http://x", "../etc", "/foo/../bar", "healthz", "/a b"} {
		if _, err := SafeAPIPath(p); err == nil {
			t.Fatalf("accepted %q", p)
		}
	}
}

func TestProbeLiveHitsMountedApp(t *testing.T) {
	id := "probe-live"
	t.Cleanup(func() { UnmountPathProxy(id) })
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" || r.URL.Path == "/__live/"+id+"/healthz" {
			io.WriteString(w, `{"ok":true}`)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(upstream.Close)
	if _, err := mountPathProxy("http://127.0.0.1:8080", id, upstream.URL, "https://github.com/acme/api", nil, true); err != nil {
		t.Fatal(err)
	}
	hit, err := ProbeLive(id, http.MethodGet, "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	if hit.Status != 200 || hit.Body == "" {
		t.Fatalf("%+v", hit)
	}
}

func TestDiscoverRoutesSeesGoHandle(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "main.go"), []byte(`
package main
func main() {
	http.HandleFunc("/healthz", h)
	mux.GET("/v1/notes", h)
}
`), 0o644); err != nil {
		t.Fatal(err)
	}
	got := DiscoverRoutes(dir)
	want := map[string]bool{"/": true, "/healthz": true, "/v1/notes": true}
	for _, p := range got {
		delete(want, p)
	}
	if len(want) > 0 {
		t.Fatalf("missing %v in %v", want, got)
	}
}
