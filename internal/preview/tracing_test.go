package preview

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/Enizri/terra/internal/trace"
)

func TestTraceMiddlewarePublishesFilteredSpans(t *testing.T) {
	repo := "https://github.com/test/trace-mw"
	_, ch, cancel := trace.Subscribe(repo)
	defer cancel()

	h := traceMiddleware(repo, "", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))
	ts := httptest.NewServer(h)
	defer ts.Close()

	for _, urlPath := range []string{"/api/v1/memos", "/assets/logo.svg"} {
		resp, err := http.Post(ts.URL+urlPath, "application/json", nil)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
	}

	select {
	case span := <-ch:
		if span.Path != "/api/v1/memos" || span.Method != "POST" || span.Status != http.StatusCreated {
			t.Errorf("span = %+v", span)
		}
	case <-time.After(time.Second):
		t.Fatal("no span published for the API request")
	}
	select {
	case span := <-ch:
		t.Errorf("asset request must not produce a span, got %+v", span)
	default:
	}
}

// Behind the path proxy, asset filtering must apply to the app-relative path:
// "/__live/{id}/src/App.tsx" is dev-server noise, "/__live/{id}/api/x" is not.
func TestTraceMiddlewareStripsPathProxyPrefix(t *testing.T) {
	repo := "https://github.com/test/trace-prefix"
	_, ch, cancel := trace.Subscribe(repo)
	defer cancel()

	h := traceMiddleware(repo, "/__live/abc", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	ts := httptest.NewServer(h)
	defer ts.Close()

	for _, urlPath := range []string{"/__live/abc/src/App.tsx", "/__live/abc/@vite/client", "/__live/abc/api/notes"} {
		resp, err := http.Get(ts.URL + urlPath)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
	}

	select {
	case span := <-ch:
		if span.Path != "/api/notes" {
			t.Errorf("span path = %q, want /api/notes (asset paths filtered, prefix stripped)", span.Path)
		}
	case <-time.After(time.Second):
		t.Fatal("no span for the API request")
	}
	select {
	case span := <-ch:
		t.Errorf("dev-server asset must not produce a span, got %+v", span)
	default:
	}
}

// The recorder must stay hijackable or the reverse proxy cannot complete
// WebSocket (101) upgrades for Vite HMR.
func TestStatusRecorderSupportsHijack(t *testing.T) {
	h := traceMiddleware("https://github.com/test/hijack", "", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, _, err := http.NewResponseController(w).Hijack()
		if err != nil {
			t.Errorf("hijack through recorder: %v", err)
			return
		}
		conn.Close()
	}))
	ts := httptest.NewServer(h)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/v1/upgrade")
	if err == nil {
		resp.Body.Close()
	}
}

// Vite HMR upgrades "/" through the reverse proxy; the middleware must not
// produce "non-Hijacker ResponseWriter type *preview.statusRecorder".
func TestTraceMiddlewareAllowsWebSocketUpgradeViaProxy(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			http.Error(w, "expected upgrade", http.StatusBadRequest)
			return
		}
		w.Header().Set("Connection", "Upgrade")
		w.Header().Set("Upgrade", "websocket")
		w.WriteHeader(http.StatusSwitchingProtocols)
		conn, bufrw, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Errorf("backend hijack: %v", err)
			return
		}
		bufrw.WriteString("upgraded")
		bufrw.Flush()
		conn.Close()
	}))
	t.Cleanup(backend.Close)

	target, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	front := httptest.NewServer(traceMiddleware("https://github.com/test/ws", "", proxy))
	t.Cleanup(front.Close)

	u, err := url.Parse(front.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultTransport.RoundTrip(&http.Request{
		Method: http.MethodGet,
		URL:    u,
		Header: http.Header{
			"Connection":           {"Upgrade"},
			"Upgrade":              {"websocket"},
			"Sec-WebSocket-Version": {"13"},
			"Sec-WebSocket-Key":    {"dGhlIHNhbXBsZSBub25jZQ=="},
		},
		Proto:      "HTTP/1.1",
		ProtoMajor: 1,
		ProtoMinor: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusSwitchingProtocols {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, want 101; body %s", resp.StatusCode, body)
	}
}
