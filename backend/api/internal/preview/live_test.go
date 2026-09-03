package preview

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Enizri/terra/backend/api/internal/config"
)

func TestPublicBaseFollowsListenAddr(t *testing.T) {
	if got := (&config.Config{Addr: "127.0.0.1:9000"}).PublicBase(); got != "http://127.0.0.1:9000" {
		t.Errorf("PublicBase() = %q, want the --addr port", got)
	}
	if got := (&config.Config{PublicURL: "https://terra.example"}).PublicBase(); got != "https://terra.example" {
		t.Errorf("PublicBase() = %q, want the explicit public URL", got)
	}
}

func TestMountPathProxyRoutesAndInjects(t *testing.T) {
	id := "test-live-hub"
	prefix := "/__live/" + id
	t.Cleanup(func() { UnmountPathProxy(id) })

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case prefix + "/", prefix:
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			io.WriteString(w, "<html><head></head><body>hi</body></html>")
		case prefix + "/api/ping":
			io.WriteString(w, "pong")
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(upstream.Close)

	publicURL, err := MountPathProxy("http://127.0.0.1:8080", id, upstream.URL, "https://github.com/acme/notes", nil)
	if err != nil {
		t.Fatal(err)
	}
	wantPrefix := "http://127.0.0.1:8080" + prefix + "/"
	if publicURL != wantPrefix {
		t.Fatalf("publicURL = %q, want %q", publicURL, wantPrefix)
	}

	mux := http.NewServeMux()
	mux.Handle("/__live/", LiveHandler())
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + prefix + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d body = %s", resp.StatusCode, body)
	}
	inject := prefix + `/__terra/select.js`
	if !strings.Contains(string(body), inject) {
		t.Fatalf("html missing inject %q: %s", inject, body)
	}

	resp, err = http.Get(ts.URL + prefix + "/api/ping")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	ping, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || string(ping) != "pong" {
		t.Fatalf("proxy = %d %q", resp.StatusCode, ping)
	}

	resp, err = http.Get(ts.URL + prefix + "/__terra/select.js")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	js, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || len(js) == 0 {
		t.Fatalf("select.js status=%d len=%d", resp.StatusCode, len(js))
	}

	UnmountPathProxy(id)
	resp, err = http.Get(ts.URL + prefix + "/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 404 {
		t.Fatalf("after unmount status = %d, want 404", resp.StatusCode)
	}
}

func TestMountPathProxyStripsPrefix(t *testing.T) {
	id := "test-strip-hub"
	prefix := "/__live/" + id
	t.Cleanup(func() { UnmountPathProxy(id) })

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/health" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, "<html><head></head><body>"+r.URL.Path+"</body></html>")
	}))
	t.Cleanup(upstream.Close)

	if _, err := mountPathProxy("http://127.0.0.1:8080", id, upstream.URL, "https://github.com/acme/notes", nil, true); err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("/__live/", LiveHandler())
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + prefix + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || !strings.Contains(string(body), "<body>/</body>") {
		t.Fatalf("stripped / got %d %s", resp.StatusCode, body)
	}

	resp, err = http.Get(ts.URL + prefix + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ = io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || !strings.Contains(string(body), "<body>/health</body>") {
		t.Fatalf("stripped /health got %d %s", resp.StatusCode, body)
	}
}
