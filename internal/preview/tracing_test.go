package preview

import (
	"net/http"
	"net/http/httptest"
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
