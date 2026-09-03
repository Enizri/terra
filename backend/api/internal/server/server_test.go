package server

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Enizri/terra/backend/api/internal/analysis"
	"github.com/Enizri/terra/backend/api/internal/analyzerclient"
	"github.com/Enizri/terra/backend/api/internal/catalog"
	"github.com/Enizri/terra/backend/api/internal/config"
	"github.com/Enizri/terra/backend/api/internal/preview"
	"github.com/Enizri/terra/backend/api/internal/scan"
	"github.com/Enizri/terra/backend/api/internal/trace"
)

func testServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	s := &Server{
		DB: filepath.Join(t.TempDir(), "terra.db"),
		Scan: func(url, _ string) (*scan.Result, error) {
			return &scan.Result{
				RepositoryURL: url,
				Name:          "notes",
				ScannedAt:     time.Now().UTC(),
				Stats:         scan.Stats{SourceFiles: 3},
			}, nil
		},
		// Empty commit disables cache-before-tarball; per-test Resolve stubs
		// supply a real SHA when they need the fast path.
		Resolve: func(url string) (string, string, string, error) {
			canonical, name, err := scan.NormalizeURL(url)
			return canonical, name, "", err
		},
		Analyze: func(ctx context.Context, res *scan.Result, opts analyzerclient.LLMOpts) (*analysis.Map, []string, error) {
			return &analysis.Map{
				Project: analysis.Project{Name: "Notes", RepositoryURL: res.RepositoryURL},
				Components: []analysis.Component{{ID: "web", Name: "Web", Purpose: "p",
					Importance: "critical", Type: "frontend", Files: []string{"web/"}}},
			}, nil, nil
		},
		// Deterministic host: skip DetectHost so tests never shell out to
		// nvidia-smi / claim the developer's MPS GPU.
		Host: func() catalog.Capabilities {
			return catalog.Capabilities{RAMGB: 16, Device: "cpu"}
		},
		RepoMeta: func(string) (string, int64, error) {
			return "", 0, fmt.Errorf("skip")
		},
	}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	// Background jobs write s.DB inside t.TempDir; drain them before cleanup.
	t.Cleanup(s.Jobs.Wait)
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
	var m analysis.Map
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
	var stored analysis.Map
	getJSON(t, fmt.Sprintf("%s/analyses/%v", ts.URL, list[0]["id"]), &stored)
	if stored.Project.Name != "Notes" {
		t.Errorf("stored = %+v", stored.Project)
	}
}

func TestAnalyzeReusesStoredMapForUnchangedCommit(t *testing.T) {
	s, ts := testServer(t)
	calls := 0
	scanCommit := "aaa111"
	s.Scan = func(url, _ string) (*scan.Result, error) {
		return &scan.Result{RepositoryURL: url, Name: "notes", Commit: scanCommit,
			ScannedAt: time.Now().UTC()}, nil
	}
	realAnalyze := s.Analyze
	s.Analyze = func(ctx context.Context, res *scan.Result, opts analyzerclient.LLMOpts) (*analysis.Map, []string, error) {
		calls++
		return realAnalyze(ctx, res, opts)
	}

	for i := 0; i < 2; i++ {
		resp := postAnalyze(t, ts, `{"repo_url":"https://github.com/acme/notes"}`)
		if resp.StatusCode != 200 {
			t.Fatalf("request %d: status = %d", i, resp.StatusCode)
		}
		var m analysis.Map
		if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
			t.Fatal(err)
		}
		if m.Project.Name != "Notes" {
			t.Errorf("request %d: map = %+v", i, m.Project)
		}
	}
	if calls != 1 {
		t.Errorf("analyzer ran %d times; an unchanged commit must be served from the store", calls)
	}

	// A new commit invalidates the cache.
	scanCommit = "bbb222"
	postAnalyze(t, ts, `{"repo_url":"https://github.com/acme/notes"}`)
	if calls != 2 {
		t.Errorf("analyzer ran %d times; a moved HEAD must re-analyze", calls)
	}
}

func TestAnalyzeStreamCacheHitEndsWithDone(t *testing.T) {
	s, ts := testServer(t)
	s.Scan = func(url, _ string) (*scan.Result, error) {
		return &scan.Result{RepositoryURL: url, Name: "notes", Commit: "aaa111",
			ScannedAt: time.Now().UTC()}, nil
	}
	postAnalyze(t, ts, `{"repo_url":"https://github.com/acme/notes"}`) // warm the store
	s.Analyze = func(ctx context.Context, res *scan.Result, opts analyzerclient.LLMOpts) (*analysis.Map, []string, error) {
		t.Error("analyzer must not run on a cache hit")
		return nil, nil, fmt.Errorf("unreachable")
	}

	req, _ := http.NewRequest("POST", ts.URL+"/analyze",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
	req.Header.Set("Accept", "application/x-ndjson")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var last map[string]any
	dec := json.NewDecoder(resp.Body)
	for dec.More() {
		if err := dec.Decode(&last); err != nil {
			t.Fatal(err)
		}
	}
	if last["stage"] != "done" || last["map"] == nil {
		t.Errorf("last event = %v, want done with the stored map", last)
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
		Stage string        `json:"stage"`
		Map   *analysis.Map `json:"map"`
	}
	dec := json.NewDecoder(resp.Body)
	for {
		if err := dec.Decode(&last); err != nil {
			break
		}
		stages = append(stages, last.Stage)
	}
	want := []string{"fetch", "scan", "analyze", "store", "done"}
	if strings.Join(stages, ",") != strings.Join(want, ",") {
		t.Fatalf("stages = %v, want %v", stages, want)
	}
	if last.Map == nil || last.Map.Project.Name != "Notes" {
		t.Errorf("done event carried no map: %+v", last.Map)
	}
}

func TestAnalyzeStreamsStructuralMapOnScan(t *testing.T) {
	s, ts := testServer(t)
	s.Scan = func(url, _ string) (*scan.Result, error) {
		return &scan.Result{
			RepositoryURL:    url,
			Name:             "notes",
			Commit:           "abc",
			ScannedAt:        time.Now().UTC(),
			PrimaryLanguages: []string{"TypeScript", "Go"},
			Stats:            scan.Stats{SourceFiles: 10, TopLevelDirs: []string{"web", "api"}},
			Tree: []scan.DirSummary{
				{Path: "web", Files: 6, Languages: []string{"TypeScript"}},
				{Path: "api", Files: 4, Languages: []string{"Go"}},
			},
			Files: []string{"web/app.ts", "api/main.go"},
			Dependencies: []scan.Manifest{
				{Manifest: "web/package.json", Ecosystem: "npm"},
				{Manifest: "go.mod", Ecosystem: "go"},
			},
		}, nil
	}

	req, _ := http.NewRequest("POST", ts.URL+"/analyze",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
	req.Header.Set("Accept", "application/x-ndjson")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	var scanEv struct {
		Stage string        `json:"stage"`
		Map   *analysis.Map `json:"map"`
	}
	dec := json.NewDecoder(resp.Body)
	for dec.More() {
		var ev struct {
			Stage string        `json:"stage"`
			Map   *analysis.Map `json:"map"`
		}
		if err := dec.Decode(&ev); err != nil {
			t.Fatal(err)
		}
		if ev.Stage == "scan" {
			scanEv = ev
		}
	}
	if scanEv.Map == nil || scanEv.Map.Project.Kind != "structural" {
		t.Fatalf("scan map = %+v, want structural provisional map", scanEv.Map)
	}
	if len(scanEv.Map.Components) != 2 {
		t.Fatalf("structural components = %d, want 2 top-level dirs", len(scanEv.Map.Components))
	}
}

func TestAnalyzeJobCacheHitSkipsScan(t *testing.T) {
	s, ts := testServer(t)
	const sha = "aaa111"
	s.Scan = func(url, _ string) (*scan.Result, error) {
		return &scan.Result{RepositoryURL: url, Name: "notes", Commit: sha,
			ScannedAt: time.Now().UTC()}, nil
	}
	s.Resolve = func(url string) (string, string, string, error) {
		canonical, name, err := scan.NormalizeURL(url)
		return canonical, name, sha, err
	}
	postAnalyze(t, ts, `{"repo_url":"https://github.com/acme/notes"}`) // warm store

	scanCalls := 0
	s.Scan = func(url, _ string) (*scan.Result, error) {
		scanCalls++
		return nil, fmt.Errorf("scan must not run on a resolve+commit cache hit")
	}
	s.Analyze = func(ctx context.Context, res *scan.Result, opts analyzerclient.LLMOpts) (*analysis.Map, []string, error) {
		t.Error("analyzer must not run on a cache hit")
		return nil, nil, fmt.Errorf("unreachable")
	}

	stage, _ := lastJobEvent(t, ts, startAnalyzeJobHTTP(t, ts))
	if stage != "done" {
		t.Fatalf("stage = %q, want done", stage)
	}
	if scanCalls != 0 {
		t.Fatalf("Scan called %d times; commit cache hit must skip the tarball", scanCalls)
	}
}

// Once the stream is open the status code is spent, so a mid-run failure has
// to arrive as an error event, not a 502.
func TestAnalyzeStreamsFailureAsEvent(t *testing.T) {
	s, ts := testServer(t)
	s.Analyze = func(ctx context.Context, res *scan.Result, opts analyzerclient.LLMOpts) (*analysis.Map, []string, error) {
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
	for {
		if err := dec.Decode(&ev); err != nil || ev.Stage == "error" {
			break
		}
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
	s.Analyze = func(ctx context.Context, res *scan.Result, opts analyzerclient.LLMOpts) (*analysis.Map, []string, error) {
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

func TestRootRedirectsWhenWebURLSet(t *testing.T) {
	t.Setenv("TERRA_WEB_URL", "http://localhost:5173/")
	_, ts := testServer(t)

	client := &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := client.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusFound)
	}
	if got := resp.Header.Get("Location"); got != "http://localhost:5173/" {
		t.Fatalf("Location = %q", got)
	}
}

func TestRootJSONWithoutWebURL(t *testing.T) {
	t.Setenv("TERRA_WEB_URL", "")
	_, ts := testServer(t)

	resp, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["service"] != "terra" || body["status"] != "ok" {
		t.Fatalf("body = %v", body)
	}
}

func TestHealthz(t *testing.T) {
	_, ts := testServer(t)
	resp, err := http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["service"] != "terra" || body["status"] != "ok" {
		t.Fatalf("body = %v", body)
	}
}

func TestTokenGate(t *testing.T) {
	t.Setenv("TERRA_TOKEN", "test-secret")
	_, ts := testServer(t)

	resp := postAnalyze(t, ts, `{"repo_url":"https://github.com/acme/notes"}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token: status = %d, want 401", resp.StatusCode)
	}

	req, err := http.NewRequest("POST", ts.URL+"/analyze",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer test-secret")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("bearer: status = %d, want 200", resp.StatusCode)
	}

	req, err = http.NewRequest("POST", ts.URL+"/jobs/analyze",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Terra-Token", "test-secret")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("x-terra-token: status = %d, want 200", resp.StatusCode)
	}

	req, err = http.NewRequest("POST", ts.URL+"/analyze",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "terra_token", Value: "test-secret"})
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("cookie: status = %d, want 200", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("healthz must stay open: status = %d", resp.StatusCode)
	}
}

// The per-process ingest token opens /traces/ingest for the preview hook,
// and nothing else — untrusted repo code must not reach the rest of the API.
func TestIngestTokenScopedToIngest(t *testing.T) {
	t.Setenv("TERRA_TOKEN", "test-secret")
	_, ts := testServer(t)

	do := func(path, body string) int {
		req, err := http.NewRequest("POST", ts.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Terra-Token", trace.IngestToken())
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}

	span := `{"repo_url":"github.com/acme/notes","spans":[{"kind":"server","method":"GET","path":"/x","status":200}]}`
	if code := do("/traces/ingest", span); code != http.StatusNoContent {
		t.Errorf("ingest with ingest token: status = %d, want 204", code)
	}
	if code := do("/analyze", `{"repo_url":"https://github.com/acme/notes"}`); code != http.StatusUnauthorized {
		t.Errorf("analyze with ingest token: status = %d, want 401", code)
	}
}

// EventSource cannot send Authorization; GET /traces accepts ?token= as fallback.
func TestTokenGateQueryParamSSE(t *testing.T) {
	t.Setenv("TERRA_TOKEN", "test-secret")
	_, ts := testServer(t)

	resp, err := http.Get(ts.URL + "/traces?repo_url=github.com/acme/x")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token: status = %d, want 401", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/traces?repo_url=github.com/acme/x&token=wrong")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong token: status = %d, want 401", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/traces?repo_url=github.com/acme/x&token=test-secret")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("query token: status = %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content-type = %q", ct)
	}

	// Query token must not unlock POSTs (headers required).
	req, err := http.NewRequest("POST", ts.URL+"/preview?token=test-secret",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("POST with query token: status = %d, want 401", resp.StatusCode)
	}
}

func TestStaticSPA(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>terra</html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("console.log(1)"), 0o644); err != nil {
		t.Fatal(err)
	}

	s := &Server{StaticDir: dir, DB: filepath.Join(t.TempDir(), "terra.db")}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(string(body), "terra") {
		t.Fatalf("GET /: status=%d body=%q", resp.StatusCode, body)
	}

	resp, err = http.Get(ts.URL + "/new/s/abc")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(string(body), "terra") {
		t.Fatalf("SPA fallback: status=%d body=%q", resp.StatusCode, body)
	}

	resp, err = http.Get(ts.URL + "/assets/app.js")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || string(body) != "console.log(1)" {
		t.Fatalf("asset: status=%d body=%q", resp.StatusCode, body)
	}

	resp, err = http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var hz map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&hz); err != nil {
		t.Fatal(err)
	}
	if hz["status"] != "ok" {
		t.Fatalf("healthz overridden by static: %v", hz)
	}
}

func TestAccessCookieOnSPA(t *testing.T) {
	t.Setenv("TERRA_TOKEN", "test-secret")
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>terra</html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := &Server{StaticDir: dir, DB: filepath.Join(t.TempDir(), "terra.db")}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	var got string
	for _, c := range resp.Cookies() {
		if c.Name == "terra_token" {
			got = c.Value
		}
	}
	if got != "test-secret" {
		t.Fatalf("GET / cookie = %q, want test-secret", got)
	}

	resp, err = http.Get(ts.URL + "/new/s/abc")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	got = ""
	for _, c := range resp.Cookies() {
		if c.Name == "terra_token" {
			got = c.Value
		}
	}
	if got != "test-secret" {
		t.Fatalf("SPA fallback cookie = %q, want test-secret", got)
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

func TestDeleteAnalysis(t *testing.T) {
	_, ts := testServer(t)
	resp := postAnalyze(t, ts, `{"repo_url":"https://github.com/acme/notes"}`)
	if resp.StatusCode != 200 {
		t.Fatalf("analyze status = %d", resp.StatusCode)
	}
	resp.Body.Close()

	var list []map[string]any
	getJSON(t, ts.URL+"/analyses", &list)
	if len(list) != 1 {
		t.Fatalf("list = %v", list)
	}
	id := list[0]["id"]

	req, err := http.NewRequest(http.MethodDelete, fmt.Sprintf("%s/analyses/%v", ts.URL, id), nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 204 {
		t.Fatalf("delete status = %d, want 204", resp.StatusCode)
	}
	resp.Body.Close()

	getJSON(t, ts.URL+"/analyses", &list)
	if len(list) != 0 {
		t.Fatalf("list after delete = %v", list)
	}

	req, err = http.NewRequest(http.MethodDelete, ts.URL+"/analyses/999", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 404 {
		t.Errorf("delete missing id: status = %d, want 404", resp.StatusCode)
	}
	resp.Body.Close()
}

type stubPreview struct {
	startErr error
	url      string
	result   preview.Result
}

func (s stubPreview) Start(string) (string, error) { return s.url, s.startErr }
func (s stubPreview) Boot(_ string, emit preview.Emitter) (preview.Result, error) {
	if emit != nil {
		emit("checkout", "Fetching the repository")
		emit("detect", "Finding apps")
		emit("ready", "Preview is up")
	}
	if s.result.URL != "" || len(s.result.Apps) > 0 {
		return s.result, s.startErr
	}
	return preview.Result{URL: s.url}, s.startErr
}
func (stubPreview) Lookup(string) (string, string, bool)    { return "", "", false }
func (stubPreview) ApplyPatch(string, string, string) error { return nil }
func (stubPreview) Restart(string) error                    { return nil }
func (stubPreview) StopAll()                                {}

func TestPreviewReturnsApps(t *testing.T) {
	s, ts := testServer(t)
	s.Preview = stubPreview{
		url: "http://preview.test/",
		result: preview.Result{
			URL:       "http://preview.test/",
			PrimaryID: "web",
			Apps: []preview.AppInfo{
				{ID: "web", Name: "web", Kind: "web", Framework: "vite", URL: "http://preview.test/", Status: "ready"},
				{ID: "mobile", Name: "ios", Kind: "mobile", Framework: "react-native", Status: "skipped", Reason: "needs a simulator"},
			},
		},
	}
	resp, err := http.Post(ts.URL+"/preview", "application/json",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var out preview.Result
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.URL != "http://preview.test/" || out.PrimaryID != "web" || len(out.Apps) != 2 {
		t.Fatalf("got %+v", out)
	}
	if out.Apps[1].Status != "skipped" || out.Apps[1].Reason == "" {
		t.Fatalf("skipped app = %+v", out.Apps[1])
	}
}

func TestPreviewUsesServerRunner(t *testing.T) {
	s, ts := testServer(t)
	s.Preview = stubPreview{startErr: fmt.Errorf("docker preview runner not implemented yet")}

	resp, err := http.Post(ts.URL+"/preview", "application/json",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "not implemented") {
		t.Fatalf("body = %s", body)
	}
}

func TestPreviewJobStreamsStages(t *testing.T) {
	s, ts := testServer(t)
	s.Preview = stubPreview{
		result: preview.Result{
			URL:       "http://preview.test/",
			PrimaryID: "web",
			Apps:      []preview.AppInfo{{ID: "web", Status: "ready", URL: "http://preview.test/"}},
		},
	}
	events := runJob(t, ts, "/jobs/preview", `{"repo_url":"https://github.com/acme/notes"}`)
	var stages []string
	for _, ev := range events {
		stages = append(stages, ev.Stage)
	}
	joined := strings.Join(stages, ",")
	for _, want := range []string{"checkout", "detect", "ready", "done"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("stages %v missing %s", stages, want)
		}
	}
	last := events[len(events)-1]
	if last.Stage != "done" || last.Answer != "http://preview.test/" {
		t.Fatalf("done = %+v", last)
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
	realBase, err := filepath.EvalSymlinks(base)
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
		if full != realBase && !strings.HasPrefix(full, realBase+string(filepath.Separator)) {
			t.Errorf("safeJoin(%q) = %q — escapes %q", p, full, realBase)
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

func TestTracesStreamsSpansAsSSE(t *testing.T) {
	_, ts := testServer(t)

	// History before connecting, then a live span after.
	trace.Publish(trace.Span{Repo: "https://github.com/acme/traced", Path: "/api/old", Method: "GET", Status: 200})

	req, _ := http.NewRequest("GET", ts.URL+"/traces?repo_url=github.com/acme/traced", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content-type = %q", ct)
	}

	go trace.Publish(trace.Span{Repo: "https://github.com/acme/traced", Path: "/api/live", Method: "POST", Status: 201})

	sc := bufio.NewScanner(resp.Body)
	var paths []string
	for sc.Scan() && len(paths) < 2 {
		line := sc.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var span trace.Span
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &span); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, span.Path)
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	if len(paths) != 2 || paths[0] != "/api/old" || paths[1] != "/api/live" {
		t.Errorf("paths = %v, want history then live", paths)
	}
}

// Spans POSTed by the in-process hook must come out of the same hub the map
// subscribes to, with Repo normalized and Time stamped server-side.
func TestIngestPublishesSpansOnTheHub(t *testing.T) {
	_, ts := testServer(t)

	_, ch, cancel := trace.Subscribe("https://github.com/acme/ingested")
	defer cancel()

	body := `{"repo_url":"github.com/acme/ingested","spans":[
		{"kind":"server","method":"POST","path":"/api/v1/memos","status":200,"dur_ms":12},
		{"kind":"client","method":"GET","path":"localhost:9090/api/v1/users","status":200,"dur_ms":3}]}`
	resp, err := http.Post(ts.URL+"/traces/ingest", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", resp.StatusCode)
	}

	var spans []trace.Span
	for len(spans) < 2 {
		select {
		case span := <-ch:
			spans = append(spans, span)
		case <-time.After(2 * time.Second):
			t.Fatalf("got %d spans, want 2", len(spans))
		}
	}
	if spans[0].Kind != "server" || spans[0].Path != "/api/v1/memos" || spans[0].DurMS != 12 {
		t.Errorf("span[0] = %+v", spans[0])
	}
	if spans[1].Kind != "client" || spans[1].Method != "GET" {
		t.Errorf("span[1] = %+v", spans[1])
	}
	for _, span := range spans {
		if span.Repo != "https://github.com/acme/ingested" {
			t.Errorf("repo = %q, want the normalized URL", span.Repo)
		}
		if span.Time.IsZero() {
			t.Error("time must be stamped server-side")
		}
	}
}

func TestIngestCapsBatchAt100(t *testing.T) {
	_, ts := testServer(t)

	var spans []string
	for i := 0; i < 150; i++ {
		spans = append(spans, fmt.Sprintf(`{"kind":"server","method":"GET","path":"/n/%d","status":200}`, i))
	}
	body := `{"repo_url":"github.com/acme/capped","spans":[` + strings.Join(spans, ",") + `]}`
	resp, err := http.Post(ts.URL+"/traces/ingest", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", resp.StatusCode)
	}
	history, _, cancel := trace.Subscribe("https://github.com/acme/capped")
	cancel()
	if len(history) != 100 {
		t.Errorf("published %d spans, want the batch capped at 100", len(history))
	}
}

func TestIngestRejectsBadBody(t *testing.T) {
	_, ts := testServer(t)
	for _, body := range []string{"", "{}", "not json", `{"repo_url":"nope","spans":[]}`} {
		resp, err := http.Post(ts.URL+"/traces/ingest", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("body %q: status = %d, want 400", body, resp.StatusCode)
		}
	}
}

func TestTracesRejectsBadRepoURL(t *testing.T) {
	_, ts := testServer(t)
	resp, err := http.Get(ts.URL + "/traces?repo_url=nope")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d", resp.StatusCode)
	}
}

func TestEnqueueAnalyzeReturnsBeforeWorkFinishes(t *testing.T) {
	s, ts := testServer(t)
	started := make(chan struct{})
	release := make(chan struct{})
	s.Analyze = func(ctx context.Context, res *scan.Result, opts analyzerclient.LLMOpts) (*analysis.Map, []string, error) {
		close(started)
		<-release
		return &analysis.Map{
			Project:    analysis.Project{Name: "Notes", RepositoryURL: res.RepositoryURL},
			Components: []analysis.Component{{ID: "web", Name: "Web", Purpose: "p", Importance: "critical", Type: "frontend"}},
		}, nil, nil
	}

	resp, err := http.Post(ts.URL+"/jobs/analyze", "application/json",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var out struct {
		JobID string `json:"job_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || out.JobID == "" {
		t.Fatalf("body = %+v err=%v", out, err)
	}

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("worker never started")
	}
	// POST already returned with job_id while Analyze is still blocked.
	close(release)

	evResp, err := http.Get(ts.URL + "/jobs/" + out.JobID + "/events")
	if err != nil {
		t.Fatal(err)
	}
	defer evResp.Body.Close()
	var last struct {
		Stage string        `json:"stage"`
		Map   *analysis.Map `json:"map"`
	}
	dec := json.NewDecoder(evResp.Body)
	for dec.More() {
		if err := dec.Decode(&last); err != nil {
			t.Fatal(err)
		}
	}
	if last.Stage != "done" || last.Map == nil || last.Map.Project.Name != "Notes" {
		t.Fatalf("last = %+v", last)
	}
}

func TestJobEventsUnknownID(t *testing.T) {
	_, ts := testServer(t)
	resp, err := http.Get(ts.URL + "/jobs/does-not-exist/events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 404 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

func TestCancelAnalyzeJob(t *testing.T) {
	s, ts := testServer(t)
	enteredScan := make(chan struct{})
	s.Scan = func(url, _ string) (*scan.Result, error) {
		close(enteredScan)
		time.Sleep(100 * time.Millisecond) // window for cancel to land
		return &scan.Result{RepositoryURL: url, Name: "notes", ScannedAt: time.Now().UTC()}, nil
	}
	s.Analyze = func(ctx context.Context, res *scan.Result, opts analyzerclient.LLMOpts) (*analysis.Map, []string, error) {
		t.Error("Analyze must not run after cancel")
		return nil, nil, fmt.Errorf("unreachable")
	}
	resp, err := http.Post(ts.URL+"/jobs/analyze", "application/json",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		JobID string `json:"job_id"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	resp.Body.Close()
	<-enteredScan

	cancelResp, err := http.Post(ts.URL+"/jobs/"+out.JobID+"/cancel", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	cancelResp.Body.Close()
	if cancelResp.StatusCode != http.StatusNoContent {
		t.Fatalf("cancel status = %d", cancelResp.StatusCode)
	}

	evResp, err := http.Get(ts.URL + "/jobs/" + out.JobID + "/events")
	if err != nil {
		t.Fatal(err)
	}
	defer evResp.Body.Close()
	var last struct{ Stage, Label string }
	dec := json.NewDecoder(evResp.Body)
	for dec.More() {
		if err := dec.Decode(&last); err != nil {
			t.Fatal(err)
		}
	}
	if last.Stage != "error" || last.Label != "cancelled" {
		t.Fatalf("last = %+v, want cancelled error", last)
	}
}

func lastJobEvent(t *testing.T, ts *httptest.Server, jobID string) (stage, label string) {
	t.Helper()
	evResp, err := http.Get(ts.URL + "/jobs/" + jobID + "/events")
	if err != nil {
		t.Fatal(err)
	}
	defer evResp.Body.Close()
	var last struct{ Stage, Label string }
	dec := json.NewDecoder(evResp.Body)
	for dec.More() {
		if err := dec.Decode(&last); err != nil {
			t.Fatal(err)
		}
	}
	return last.Stage, last.Label
}

func startAnalyzeJobHTTP(t *testing.T, ts *httptest.Server) string {
	t.Helper()
	resp, err := http.Post(ts.URL+"/jobs/analyze", "application/json",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct {
		JobID string `json:"job_id"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	return out.JobID
}

func TestAnalyzeJobDeadline(t *testing.T) {
	cases := []struct {
		name    string
		timeout string
		block   bool
		want    string // substring of the terminal label; "" means stage done
	}{
		{"deadline fires", "50ms", true, "exceeded the"},
		{"generous timeout", "1h", false, ""},
		{"bogus falls back", "bogus", false, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv("TERRA_ANALYZE_TIMEOUT", c.timeout)
			s, ts := testServer(t)
			s.Analyze = func(ctx context.Context, res *scan.Result, opts analyzerclient.LLMOpts) (*analysis.Map, []string, error) {
				if c.block {
					<-ctx.Done()
					return nil, nil, ctx.Err()
				}
				return &analysis.Map{
					Project:    analysis.Project{Name: "Notes", RepositoryURL: res.RepositoryURL},
					Components: []analysis.Component{{ID: "web", Name: "Web", Purpose: "p", Importance: "critical", Type: "frontend"}},
				}, nil, nil
			}
			stage, label := lastJobEvent(t, ts, startAnalyzeJobHTTP(t, ts))
			if c.want == "" {
				if stage != "done" {
					t.Fatalf("stage = %q label = %q, want done", stage, label)
				}
				return
			}
			if stage != "error" || !strings.Contains(label, c.want) {
				t.Fatalf("stage = %q label = %q, want error containing %q", stage, label, c.want)
			}
		})
	}
}

func TestCancelPropagatesToAnalyze(t *testing.T) {
	s, ts := testServer(t)
	entered := make(chan struct{})
	s.Analyze = func(ctx context.Context, res *scan.Result, opts analyzerclient.LLMOpts) (*analysis.Map, []string, error) {
		close(entered)
		<-ctx.Done() // hangs forever unless cancel reaches the in-flight call
		return nil, nil, ctx.Err()
	}
	jobID := startAnalyzeJobHTTP(t, ts)
	<-entered

	cancelResp, err := http.Post(ts.URL+"/jobs/"+jobID+"/cancel", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	cancelResp.Body.Close()

	stage, label := lastJobEvent(t, ts, jobID)
	// Exactly "cancelled": the web client treats that label as a silent abort.
	if stage != "error" || label != "cancelled" {
		t.Fatalf("stage = %q label = %q, want error/cancelled", stage, label)
	}
}

func TestBodyTooLarge(t *testing.T) {
	t.Setenv("TERRA_RATE_LIMIT", "0")
	_, ts := testServer(t)
	huge := `{"repo_url":"https://github.com/acme/notes","pad":"` +
		strings.Repeat("x", 2<<20) + `"}`
	for _, path := range []string{"/analyze", "/jobs/analyze", "/preview", "/preview/patch", "/preview/restart", "/preview/probe", "/jobs/ask", "/jobs/agent", "/jobs/preview", "/jobs/preview/test", "/jobs/preview/cli", "/traces/ingest"} {
		resp, err := http.Post(ts.URL+path, "application/json", strings.NewReader(huge))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusRequestEntityTooLarge {
			t.Errorf("%s with 2MiB body = %d, want 413", path, resp.StatusCode)
		}
	}
}

func TestAnalyzeQueueRejectsWhenFull(t *testing.T) {
	t.Setenv("TERRA_ANALYZE_CONCURRENCY", "1")
	t.Setenv("TERRA_RATE_LIMIT", "0")
	s, ts := testServer(t)
	gate := make(chan struct{})
	s.Analyze = func(ctx context.Context, res *scan.Result, opts analyzerclient.LLMOpts) (*analysis.Map, []string, error) {
		<-gate
		return nil, nil, fmt.Errorf("released")
	}

	post := func() *http.Response {
		resp, err := http.Post(ts.URL+"/jobs/analyze", "application/json",
			strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}

	first := post()
	var out struct {
		JobID string `json:"job_id"`
	}
	json.NewDecoder(first.Body).Decode(&out)
	first.Body.Close()
	if first.StatusCode != 200 || out.JobID == "" {
		t.Fatalf("first = %d %+v", first.StatusCode, out)
	}

	// The slot is claimed before the id is returned, so this is a real 429,
	// not a 200 followed by an error event.
	second := post()
	second.Body.Close()
	if second.StatusCode != 429 {
		t.Fatalf("second while full = %d, want 429", second.StatusCode)
	}

	// Sync /analyze shares the same semaphore.
	syncResp := post2(t, ts, "/analyze")
	if syncResp != 429 {
		t.Fatalf("sync /analyze while full = %d, want 429", syncResp)
	}

	close(gate)
	lastJobEvent(t, ts, out.JobID) // drain: slot released when the job finishes
	third := post()
	third.Body.Close()
	if third.StatusCode != 200 {
		t.Fatalf("after release = %d, want 200", third.StatusCode)
	}
}

func post2(t *testing.T, ts *httptest.Server, path string) int {
	t.Helper()
	resp, err := http.Post(ts.URL+path, "application/json",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

func TestEnqueueAskReturnsBeforeWorkFinishes(t *testing.T) {
	s, ts := testServer(t)
	started := make(chan struct{})
	release := make(chan struct{})
	s.RunTask = func(ctx context.Context, name string, payload any) (json.RawMessage, error) {
		if name != "qa" {
			t.Fatalf("task = %q", name)
		}
		close(started)
		<-release
		return json.RawMessage(`{"answer":"hello from qa"}`), nil
	}

	resp, err := http.Post(ts.URL+"/jobs/ask", "application/json",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes","question":"where?"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var out struct {
		JobID string `json:"job_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || out.JobID == "" {
		t.Fatalf("body = %+v err=%v", out, err)
	}

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("qa worker never started")
	}
	close(release)

	evResp, err := http.Get(ts.URL + "/jobs/" + out.JobID + "/events")
	if err != nil {
		t.Fatal(err)
	}
	defer evResp.Body.Close()
	var last struct {
		Stage  string `json:"stage"`
		Answer string `json:"answer"`
	}
	dec := json.NewDecoder(evResp.Body)
	for dec.More() {
		if err := dec.Decode(&last); err != nil {
			t.Fatal(err)
		}
	}
	if last.Stage != "done" || last.Answer != "hello from qa" {
		t.Fatalf("last = %+v", last)
	}
}

func TestModelsAndHostCapabilitiesAreOpen(t *testing.T) {
	s := &Server{Cfg: &config.Config{Token: "secret", AnalyzeConcurrency: 1}}
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/models")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /models without a token: %s", resp.Status)
	}
	var out struct {
		Models []catalog.Entry `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if len(out.Models) == 0 {
		t.Fatal("catalog came back empty")
	}

	capsResp, err := http.Get(ts.URL + "/host/capabilities")
	if err != nil {
		t.Fatal(err)
	}
	defer capsResp.Body.Close()
	if capsResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /host/capabilities without a token: %s", capsResp.Status)
	}
	var caps catalog.Capabilities
	if err := json.NewDecoder(capsResp.Body).Decode(&caps); err != nil {
		t.Fatal(err)
	}
	if caps.Device == "" {
		t.Error("capabilities must always name a device")
	}
}
