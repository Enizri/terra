package graph

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"terra/internal/scan"
)

func testScan() *scan.Result {
	return &scan.Result{
		RepositoryURL:    "https://github.com/acme/notes",
		Name:             "notes",
		PrimaryLanguages: []string{"Go"},
		Stats:            scan.Stats{SourceFiles: 3, TopLevelDirs: []string{"server", "web"}},
		Files:            []string{"server/main.go", "web/app.tsx"},
		Dirs:             []string{"server", "web"},
	}
}

// fakeAnalyzer serves /healthz and /analyze the way the Python service does.
func fakeAnalyzer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("POST /analyze", handler)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestAnalyzeAssemblesScanFacts(t *testing.T) {
	var gotReq map[string]any
	srv := fakeAnalyzer(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&gotReq)
		json.NewEncoder(w).Encode(map[string]any{
			"draft": map[string]any{
				"description": " A note app. ",
				"kind":        "Web application",
				"components": []map[string]any{
					{"id": "server", "parent_id": nil, "name": "Server", "purpose": "p",
						"importance": "critical", "type": "backend", "files": []string{"server/"}, "file_count": 1},
				},
				"relationships":       []map[string]any{{"from": "server", "to": "server2", "type": "calls", "because": []string{"x"}}},
				"suggested_questions": []string{"q1"},
			},
			"warnings": []string{"heads up"},
		})
	})
	t.Setenv("TERRA_ANALYZER_URL", srv.URL)

	m, warnings, err := Analyze(testScan(), "some-model")
	if err != nil {
		t.Fatal(err)
	}
	// The request carries the scan verbatim plus the model override.
	if gotReq["model"] != "some-model" {
		t.Errorf("model = %v", gotReq["model"])
	}
	if gotReq["scan"].(map[string]any)["name"] != "notes" {
		t.Errorf("scan not forwarded: %v", gotReq["scan"])
	}
	// Facts come from the scan, judgement from the draft.
	if m.Project.Name != "Notes" {
		t.Errorf("Name = %q, want title-cased scan name", m.Project.Name)
	}
	if m.Project.Description != "A note app." {
		t.Errorf("Description = %q", m.Project.Description)
	}
	if m.Project.Stats.ApproxSourceFiles != 3 || len(m.Project.PrimaryLanguages) != 1 {
		t.Errorf("scan stats not assembled: %+v", m.Project)
	}
	if len(m.Components) != 1 || m.Components[0].ParentID != nil {
		t.Errorf("components = %+v", m.Components)
	}
	if len(warnings) != 1 || warnings[0] != "heads up" {
		t.Errorf("warnings = %v", warnings)
	}
}

func TestAnalyzeRejectsEmptyComponents(t *testing.T) {
	srv := fakeAnalyzer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"draft":{"components":[]},"warnings":[]}`))
	})
	t.Setenv("TERRA_ANALYZER_URL", srv.URL)

	_, _, err := Analyze(testScan(), "")
	if err == nil || !strings.Contains(err.Error(), "no components") {
		t.Fatalf("err = %v", err)
	}
}

func TestAnalyzePropagates502Detail(t *testing.T) {
	srv := fakeAnalyzer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		w.Write([]byte(`{"detail":"model qwen2.5:3b produced no usable map after two attempts"}`))
	})
	t.Setenv("TERRA_ANALYZER_URL", srv.URL)

	_, _, err := Analyze(testScan(), "")
	if err == nil || !strings.Contains(err.Error(), "no usable map after two attempts") {
		t.Fatalf("err = %v", err)
	}
}

func TestAnalyzeWhenServiceIsDown(t *testing.T) {
	t.Setenv("TERRA_ANALYZER_URL", "http://127.0.0.1:1")

	_, _, err := Analyze(testScan(), "")
	if err == nil || !strings.Contains(err.Error(), "TERRA_ANALYZER_URL") {
		t.Fatalf("err = %v, want a hint mentioning TERRA_ANALYZER_URL", err)
	}
}
