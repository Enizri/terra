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

	"github.com/Enizri/terra/internal/graph"
	"github.com/Enizri/terra/internal/preview"
	"github.com/Enizri/terra/internal/scan"
	"github.com/Enizri/terra/internal/trace"
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
		Analyze: func(ctx context.Context, res *scan.Result, model string) (*graph.Map, []string, error) {
			return &graph.Map{
				Project: graph.Project{Name: "Notes", RepositoryURL: res.RepositoryURL},
				Components: []graph.Component{{ID: "web", Name: "Web", Purpose: "p",
					Importance: "critical", Type: "frontend", Files: []string{"web/"}}},
			}, nil, nil
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

func TestAnalyzeReusesStoredMapForUnchangedCommit(t *testing.T) {
	s, ts := testServer(t)
	calls := 0
	scanCommit := "aaa111"
	s.Scan = func(url string) (*scan.Result, error) {
		return &scan.Result{RepositoryURL: url, Name: "notes", Commit: scanCommit,
			ScannedAt: time.Now().UTC()}, nil
	}
	realAnalyze := s.Analyze
	s.Analyze = func(ctx context.Context, res *scan.Result, model string) (*graph.Map, []string, error) {
		calls++
		return realAnalyze(ctx, res, model)
	}

	for i := 0; i < 2; i++ {
		resp := postAnalyze(t, ts, `{"repo_url":"https://github.com/acme/notes"}`)
		if resp.StatusCode != 200 {
			t.Fatalf("request %d: status = %d", i, resp.StatusCode)
		}
		var m graph.Map
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
	s.Scan = func(url string) (*scan.Result, error) {
		return &scan.Result{RepositoryURL: url, Name: "notes", Commit: "aaa111",
			ScannedAt: time.Now().UTC()}, nil
	}
	postAnalyze(t, ts, `{"repo_url":"https://github.com/acme/notes"}`) // warm the store
	s.Analyze = func(ctx context.Context, res *scan.Result, model string) (*graph.Map, []string, error) {
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
	s.Analyze = func(ctx context.Context, res *scan.Result, model string) (*graph.Map, []string, error) {
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
	s.Analyze = func(ctx context.Context, res *scan.Result, model string) (*graph.Map, []string, error) {
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
	r := preview.Host()
	if got := snippet(r, repo, "main.go", 0); got != "" {
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
	if got := snippet(r, repo, "main.go", 0); !strings.Contains(got, "package main") {
		t.Errorf("existing checkout: snippet = %q, want the file's contents", got)
	}
	if got := snippet(r, repo, "../outside.go", 0); got != "" {
		t.Errorf("traversal: snippet = %q, want empty", got)
	}
	if got := snippet(r, "not a repo url", "main.go", 0); got != "" {
		t.Errorf("bad url: snippet = %q, want empty", got)
	}
}

type stubPreview struct {
	startErr error
	url      string
}

func (s stubPreview) Start(string) (string, error)       { return s.url, s.startErr }
func (stubPreview) Lookup(string) (string, string, bool) { return "", "", false }
func (stubPreview) StopAll()                             {}

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
	s.Analyze = func(ctx context.Context, res *scan.Result, model string) (*graph.Map, []string, error) {
		close(started)
		<-release
		return &graph.Map{
			Project:    graph.Project{Name: "Notes", RepositoryURL: res.RepositoryURL},
			Components: []graph.Component{{ID: "web", Name: "Web", Purpose: "p", Importance: "critical", Type: "frontend"}},
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
		Stage string     `json:"stage"`
		Map   *graph.Map `json:"map"`
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
	s.Scan = func(url string) (*scan.Result, error) {
		close(enteredScan)
		time.Sleep(100 * time.Millisecond) // window for cancel to land
		return &scan.Result{RepositoryURL: url, Name: "notes", ScannedAt: time.Now().UTC()}, nil
	}
	s.Analyze = func(ctx context.Context, res *scan.Result, model string) (*graph.Map, []string, error) {
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
			s.Analyze = func(ctx context.Context, res *scan.Result, model string) (*graph.Map, []string, error) {
				if c.block {
					<-ctx.Done()
					return nil, nil, ctx.Err()
				}
				return &graph.Map{
					Project:    graph.Project{Name: "Notes", RepositoryURL: res.RepositoryURL},
					Components: []graph.Component{{ID: "web", Name: "Web", Purpose: "p", Importance: "critical", Type: "frontend"}},
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
	s.Analyze = func(ctx context.Context, res *scan.Result, model string) (*graph.Map, []string, error) {
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
	for _, path := range []string{"/analyze", "/jobs/analyze", "/preview", "/jobs/ask", "/traces/ingest"} {
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
	s.Analyze = func(ctx context.Context, res *scan.Result, model string) (*graph.Map, []string, error) {
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
