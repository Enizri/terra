package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Enizri/terra/internal/config"
)

// Characterization: public routes stay registered with stable method+path.
func TestPublicRoutesRegistered(t *testing.T) {
	s := &Server{
		DB: t.TempDir() + "/terra.db",
		Cfg: &config.Config{
			AnalyzeConcurrency: 1,
			AnalyzeTimeout:     time.Minute,
		},
	}
	h := s.Handler()

	cases := []struct {
		method, path string
	}{
		{"GET", "/healthz"},
		{"GET", "/models"},
		{"GET", "/host/capabilities"},
		{"GET", "/analyses"},
		{"POST", "/analyze"},
		{"POST", "/jobs/probe"},
		{"POST", "/jobs/analyze"},
		{"POST", "/jobs/ask"},
		{"POST", "/preview"},
		{"POST", "/ask"},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusNotFound {
			t.Errorf("%s %s → 404; route missing", tc.method, tc.path)
		}
	}
}
