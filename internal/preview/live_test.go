package preview

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPublicBaseURLFollowsListenAddr(t *testing.T) {
	t.Setenv("TERRA_PUBLIC_URL", "")
	t.Setenv("TERRA_ADDR", "127.0.0.1:9000")
	if got := publicBaseURL(); got != "http://127.0.0.1:9000" {
		t.Errorf("publicBaseURL() = %q, want the --addr port", got)
	}
	t.Setenv("TERRA_PUBLIC_URL", "https://terra.example/")
	if got := publicBaseURL(); got != "https://terra.example" {
		t.Errorf("publicBaseURL() = %q, want the explicit public URL", got)
	}
}

func TestMountPathProxyRoutesAndInjects(t *testing.T) {
	t.Setenv("TERRA_PUBLIC_URL", "http://127.0.0.1:8080")

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

	publicURL, err := MountPathProxy(id, upstream.URL, "https://github.com/acme/notes", nil)
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
