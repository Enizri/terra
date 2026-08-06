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

	h := traceMiddleware(repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
