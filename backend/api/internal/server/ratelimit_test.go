package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Enizri/terra/backend/api/internal/analysis"
	"github.com/Enizri/terra/backend/api/internal/analyzerclient"
	"github.com/Enizri/terra/backend/api/internal/scan"
)

// serveAs sends a request through the full handler with a hand-set client IP;
// httptest.NewServer can't vary RemoteAddr, so per-IP behaviour needs this.
func serveAs(h http.Handler, method, path, ip string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
	req.RemoteAddr = ip + ":12345"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func limiterTestHandler(t *testing.T) http.Handler {
	t.Helper()
	s := &Server{
		DB: filepath.Join(t.TempDir(), "terra.db"),
		Scan: func(url, _ string) (*scan.Result, error) {
			return &scan.Result{RepositoryURL: url, Name: "notes", ScannedAt: time.Now().UTC()}, nil
		},
		Analyze: func(ctx context.Context, res *scan.Result, opts analyzerclient.LLMOpts) (*analysis.Map, []string, error) {
			return &analysis.Map{
				Project:    analysis.Project{Name: "Notes", RepositoryURL: res.RepositoryURL},
				Components: []analysis.Component{{ID: "web", Name: "Web", Purpose: "p", Importance: "critical", Type: "frontend"}},
			}, nil, nil
		},
	}
	h := s.Handler()
	// Background jobs write s.DB inside t.TempDir; drain them before cleanup.
	t.Cleanup(s.Jobs.Wait)
	return h
}

func TestRateLimitPerIP(t *testing.T) {
	t.Setenv("TERRA_RATE_LIMIT", "1") // burst 10
	t.Setenv("TERRA_ANALYZE_CONCURRENCY", "1000")
	h := limiterTestHandler(t)

	for i := 0; i < 10; i++ {
		if rec := serveAs(h, "POST", "/jobs/analyze", "1.2.3.4"); rec.Code == 429 {
			t.Fatalf("request %d within burst got 429", i+1)
		}
	}
	rec := serveAs(h, "POST", "/jobs/analyze", "1.2.3.4")
	if rec.Code != 429 {
		t.Fatalf("11th request = %d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") != "1" {
		t.Errorf("Retry-After = %q", rec.Header().Get("Retry-After"))
	}
	var body struct {
		Error string `json:"error"`
	}
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Error == "" {
		t.Error("429 body has no error message")
	}

	// A different IP is unaffected.
	if rec := serveAs(h, "POST", "/jobs/analyze", "5.6.7.8"); rec.Code == 429 {
		t.Fatalf("separate IP got 429")
	}
}

func TestRateLimitExemptPaths(t *testing.T) {
	t.Setenv("TERRA_RATE_LIMIT", "1")
	t.Setenv("TERRA_ANALYZE_CONCURRENCY", "1000")
	h := limiterTestHandler(t)
	for i := 0; i < 50; i++ {
		if rec := serveAs(h, "GET", "/healthz", "1.2.3.4"); rec.Code == 429 {
			t.Fatal("/healthz got rate limited")
		}
		if rec := serveAs(h, "POST", "/traces/ingest", "1.2.3.4"); rec.Code == 429 {
			t.Fatal("/traces/ingest got rate limited")
		}
	}
}

func TestRateLimitDisabled(t *testing.T) {
	t.Setenv("TERRA_RATE_LIMIT", "0")
	t.Setenv("TERRA_ANALYZE_CONCURRENCY", "1000")
	h := limiterTestHandler(t)
	for i := 0; i < 100; i++ {
		if rec := serveAs(h, "POST", "/jobs/analyze", "1.2.3.4"); rec.Code == 429 {
			t.Fatal("got 429 with limiter disabled")
		}
	}
}

func TestLimiterPrunesIdleVisitors(t *testing.T) {
	l := &ipLimiter{seen: map[string]*visitor{}, rps: 1, burst: 10}
	l.allow("old")
	l.seen["old"].last = time.Now().Add(-time.Hour)
	l.allow("new")
	if _, ok := l.seen["old"]; ok {
		t.Fatal("idle visitor not pruned")
	}
	if _, ok := l.seen["new"]; !ok {
		t.Fatal("fresh visitor missing")
	}
}
