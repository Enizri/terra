package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Enizri/terra/internal/graph"
	"github.com/Enizri/terra/internal/scan"
)

func testServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	s := &Server{
		DB: filepath.Join(t.TempDir(), "terra.db"),
		Scan: func(url string) (*scan.Result, error) {
			return &scan.Result{
				RepositoryURL: url,
				Name:          "notes",
				ScannedAt:     time.Now().UTC(),
				Stats:         scan.Stats{SourceFiles: 3},
			}, nil
		},
		Analyze: func(res *scan.Result, model string) (*graph.Map, []string, error) {
			return &graph.Map{
				Project: graph.Project{Name: "Notes", RepositoryURL: res.RepositoryURL},
				Components: []graph.Component{{ID: "web", Name: "Web", Purpose: "p",
					Importance: "critical", Type: "frontend", Files: []string{"web/"}}},
			}, nil, nil
		},
	}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return s, ts
}

func postAnalyze(t *testing.T, ts *httptest.Server, body string) *http.Response {
	t.Helper()
	resp, err := http.Post(ts.URL+"/analyze", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestAnalyzeStoresAndReturnsMap(t *testing.T) {
	_, ts := testServer(t)

	resp := postAnalyze(t, ts, `{"repo_url":"https://github.com/acme/notes"}`)
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var m graph.Map
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		t.Fatal(err)
	}
	if m.Project.Name != "Notes" || len(m.Components) != 1 {
		t.Errorf("map = %+v", m)
	}

	// The analysis must now be listed and fetchable.
	var list []map[string]any
	getJSON(t, ts.URL+"/analyses", &list)
	if len(list) != 1 || list[0]["repo_url"] != "https://github.com/acme/notes" {
		t.Fatalf("list = %v", list)
	}
	var stored graph.Map
	getJSON(t, fmt.Sprintf("%s/analyses/%v", ts.URL, list[0]["id"]), &stored)
	if stored.Project.Name != "Notes" {
		t.Errorf("stored = %+v", stored.Project)
	}
}

func TestAnalyzeStreamsStages(t *testing.T) {
	_, ts := testServer(t)

	req, _ := http.NewRequest("POST", ts.URL+"/analyze",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
	req.Header.Set("Accept", "application/x-ndjson")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "application/x-ndjson" {
		t.Fatalf("content-type = %q", ct)
	}

	var stages []string
	var last struct {
		Stage string     `json:"stage"`
		Map   *graph.Map `json:"map"`
	}
	dec := json.NewDecoder(resp.Body)
	for {
		if err := dec.Decode(&last); err != nil {
			break
		}
		stages = append(stages, last.Stage)
	}
	want := []string{"clone", "scan", "analyze", "store", "done"}
	if strings.Join(stages, ",") != strings.Join(want, ",") {
		t.Fatalf("stages = %v, want %v", stages, want)
	}
	if last.Map == nil || last.Map.Project.Name != "Notes" {
		t.Errorf("done event carried no map: %+v", last.Map)
	}
}

// Once the stream is open the status code is spent, so a mid-run failure has
// to arrive as an error event, not a 502.
func TestAnalyzeStreamsFailureAsEvent(t *testing.T) {
	s, ts := testServer(t)
	s.Analyze = func(res *scan.Result, model string) (*graph.Map, []string, error) {
		return nil, nil, fmt.Errorf("cannot reach the analyzer service")
	}
	req, _ := http.NewRequest("POST", ts.URL+"/analyze",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
	req.Header.Set("Accept", "application/x-ndjson")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var ev struct{ Stage, Label string }
	dec := json.NewDecoder(resp.Body)
	for dec.Decode(&ev) == nil && ev.Stage != "error" {
	}
	if ev.Stage != "error" || !strings.Contains(ev.Label, "analyzer") {
		t.Errorf("last event = %+v", ev)
	}
}

// A URL the scanner would reject must fail before streaming starts, while a
// status code can still say so.
func TestAnalyzeRejectsBadURLBeforeStreaming(t *testing.T) {
	_, ts := testServer(t)
	req, _ := http.NewRequest("POST", ts.URL+"/analyze", strings.NewReader(`{"repo_url":"not-a-url"}`))
	req.Header.Set("Accept", "application/x-ndjson")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestAnalyzeRejectsBadBody(t *testing.T) {
	_, ts := testServer(t)
	for _, body := range []string{"", "{}", "not json"} {
		if resp := postAnalyze(t, ts, body); resp.StatusCode != 400 {
			t.Errorf("body %q: status = %d, want 400", body, resp.StatusCode)
		}
	}
}

func TestAnalyzeReportsAnalyzerFailure(t *testing.T) {
	s, ts := testServer(t)
	s.Analyze = func(res *scan.Result, model string) (*graph.Map, []string, error) {
		return nil, nil, fmt.Errorf("cannot reach the analyzer service")
	}
	resp := postAnalyze(t, ts, `{"repo_url":"https://github.com/acme/notes"}`)
	if resp.StatusCode != 502 {
		t.Fatalf("status = %d, want 502", resp.StatusCode)
	}
	var e map[string]string
	json.NewDecoder(resp.Body).Decode(&e)
	if !strings.Contains(e["error"], "analyzer") {
		t.Errorf("error = %q", e["error"])
	}
}

func TestGetUnknownIDIs404(t *testing.T) {
	_, ts := testServer(t)
	resp, err := http.Get(ts.URL + "/analyses/999")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 404 {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
	if resp, _ := http.Get(ts.URL + "/analyses/abc"); resp.StatusCode != 400 {
		t.Errorf("non-numeric id: status = %d, want 400", resp.StatusCode)
	}
}

// snippet answers workspace questions with no preview running, so it falls
// back to an already-cloned checkout — and must never clone one itself.
func TestSnippetFallsBackToExistingCheckout(t *testing.T) {
	// UserCacheDir reads $HOME on darwin and $XDG_CACHE_HOME elsewhere; pin both
	// so a real checkout on the dev machine can't answer for the "missing" case.
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CACHE_HOME", filepath.Join(home, "cache"))

	const repo = "github.com/usememos/memos"
	if got := snippet(repo, "main.go", 0); got != "" {
		t.Errorf("no preview and no checkout: snippet = %q, want empty", got)
	}

	dir, err := scan.CheckoutDir(repo)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := snippet(repo, "main.go", 0); !strings.Contains(got, "package main") {
		t.Errorf("existing checkout: snippet = %q, want the file's contents", got)
	}
	if got := snippet(repo, "../outside.go", 0); got != "" {
		t.Errorf("traversal: snippet = %q, want empty", got)
	}
	if got := snippet("not a repo url", "main.go", 0); got != "" {
		t.Errorf("bad url: snippet = %q, want empty", got)
	}
}

func getJSON(t *testing.T, url string, v any) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("GET %s: %d", url, resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
		t.Fatal(err)
	}
}

// safeJoin is the trust boundary for /files: `path` comes from the browser and
// is joined onto the checkout root.
func TestSafeJoinContainsEveryPath(t *testing.T) {
	base := t.TempDir()
	real, err := filepath.EvalSymlinks(base)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{
		"", "/", "src", "src/main.tsx", "src/../src/main.tsx",
		"../etc/passwd", "../../etc/passwd", "src/../../../outside", "/../etc/passwd",
	} {
		full, clean, err := safeJoin(base, p)
		if err != nil {
			continue // rejected outright is also contained
		}
		if strings.Contains(clean, "..") {
			t.Errorf("safeJoin(%q) kept a traversal segment: %q", p, clean)
		}
		if full != real && !strings.HasPrefix(full, real+string(filepath.Separator)) {
			t.Errorf("safeJoin(%q) = %q — escapes %q", p, full, real)
		}
	}

	// A symlink inside the checkout pointing out of it is the case textual
	// cleaning cannot catch.
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(base, "escape")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := safeJoin(base, "escape"); err == nil {
		t.Error("safeJoin followed a symlink out of the checkout")
	}
}
