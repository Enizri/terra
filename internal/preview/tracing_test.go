package preview

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Enizri/terra/internal/trace"
)

func TestTraceworthy(t *testing.T) {
	cases := map[string]bool{
		"/":                                    true,
		"/api/v1/memos":                        true,
		"/memos.api.v1.MemoService/CreateMemo": true, // RPC dots are not extensions
		"/auth":                                true,
		"/src/main.tsx":                        false,
		"/@vite/client":                        false,
		"/assets/logo.svg":                     false,
		"/node_modules/.vite/deps/react.js":    false,
		"/__terra/select.js":                   false,
		"/main.abc123.hot-update.json":         false,
		"/bundle.JS":                           false, // extension check is case-insensitive
	}
	for path, want := range cases {
		if got := traceworthy(path); got != want {
			t.Errorf("traceworthy(%q) = %v, want %v", path, got, want)
		}
	}
}

func TestTraceMiddlewarePublishesFilteredSpans(t *testing.T) {
	repo := "https://github.com/test/trace-mw"
	_, ch, cancel := trace.Subscribe(repo)
	defer cancel()

	h := traceMiddleware(repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))
	ts := httptest.NewServer(h)
	defer ts.Close()

	for _, p := range []string{"/api/v1/memos", "/assets/logo.svg"} {
		resp, err := http.Post(ts.URL+p, "application/json", nil)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
	}

	select {
	case s := <-ch:
		if s.Path != "/api/v1/memos" || s.Method != "POST" || s.Status != http.StatusCreated {
			t.Errorf("span = %+v", s)
		}
	case <-time.After(time.Second):
		t.Fatal("no span published for the API request")
	}
	select {
	case s := <-ch:
		t.Errorf("asset request must not produce a span, got %+v", s)
	default:
	}
}
