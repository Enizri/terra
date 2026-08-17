package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Enizri/terra/backend/api/internal/analysis"
	"github.com/Enizri/terra/backend/api/internal/analyzerclient"
	"github.com/Enizri/terra/backend/api/internal/catalog"
	"github.com/Enizri/terra/backend/api/internal/config"
	"github.com/Enizri/terra/backend/api/internal/job"
	"github.com/Enizri/terra/backend/api/internal/scan"
)

// runJob posts body to path, then drains the created job's NDJSON stream.
func runJob(t *testing.T, ts *httptest.Server, path, body string) []job.Event {
	t.Helper()
	resp, err := http.Post(ts.URL+path, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST %s: status %d", path, resp.StatusCode)
	}
	var created struct {
		JobID string `json:"job_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil || created.JobID == "" {
		t.Fatalf("POST %s: bad body (%+v, %v)", path, created, err)
	}

	stream, err := http.Get(ts.URL + "/jobs/" + created.JobID + "/events")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	var events []job.Event
	dec := json.NewDecoder(stream.Body)
	for {
		var ev job.Event
		if err := dec.Decode(&ev); err != nil {
			return events
		}
		events = append(events, ev)
	}
}

func stages(events []job.Event) []string {
	out := make([]string, len(events))
	for i, ev := range events {
		out[i] = ev.Stage
	}
	return out
}

func lastEvent(t *testing.T, events []job.Event) job.Event {
	t.Helper()
	if len(events) == 0 {
		t.Fatal("job emitted no events")
	}
	return events[len(events)-1]
}

func TestProbeStreamsToARecommendation(t *testing.T) {
	s, ts := testServer(t)
	s.RepoMeta = func(string) (string, int64, error) { return "Go", 900, nil }

	events := runJob(t, ts, "/jobs/probe", `{"repo_url":"https://github.com/acme/notes"}`)
	if got := strings.Join(stages(events), ","); got != "fetch,recommend,scan,done" {
		t.Fatalf("stages = %s", got)
	}
	done := lastEvent(t, events)
	if done.ProbeID == "" {
		t.Error("done event carried no probe_id")
	}
	if done.Recommendation == nil || catalog.Find(done.Recommendation.ModelID) == nil {
		t.Fatalf("done recommendation = %+v", done.Recommendation)
	}
	if done.Repo == nil || done.Repo.URL != "https://github.com/acme/notes" {
		t.Errorf("done repo = %+v", done.Repo)
	}
	// The structural map lands on scan so the workspace paints behind the gate.
	if events[2].Map == nil {
		t.Error("scan event carried no structural map")
	}
}

func TestProbeSurvivesGitHubMetadataFailure(t *testing.T) {
	s, ts := testServer(t)
	s.RepoMeta = func(string) (string, int64, error) { return "", 0, fmt.Errorf("rate limited") }

	events := runJob(t, ts, "/jobs/probe", `{"repo_url":"https://github.com/acme/notes"}`)
	if got := strings.Join(stages(events), ","); got != "fetch,scan,done" {
		t.Fatalf("stages = %s; a metadata failure must only drop the provisional guess", got)
	}
	if lastEvent(t, events).Recommendation == nil {
		t.Error("refined recommendation missing")
	}
}

func TestProbeTakesNoAnalyzeSlot(t *testing.T) {
	s := &Server{
		Cfg:     &config.Config{AnalyzeConcurrency: 1, AnalyzeTimeout: time.Minute},
		Resolve: func(url string) (string, string, string, error) { return url, "notes", "", nil },
		Scan: func(url, _ string) (*scan.Result, error) {
			return &scan.Result{RepositoryURL: url, Name: "notes"}, nil
		},
		RepoMeta: func(string) (string, int64, error) { return "", 0, fmt.Errorf("skip") },
	}
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()
	t.Cleanup(s.Jobs.Wait)

	for i := 0; i < 3; i++ {
		runJob(t, ts, "/jobs/probe", `{"repo_url":"https://github.com/acme/notes"}`)
	}
	// With concurrency 1, a probe that claimed a slot would have 429'd by now.
	if len(s.analyzeSlots) != 0 {
		t.Errorf("probe left %d analyze slots held", len(s.analyzeSlots))
	}
}

func TestProbeRejectsANonGitHubURL(t *testing.T) {
	_, ts := testServer(t)
	resp, err := http.Post(ts.URL+"/jobs/probe", "application/json",
		strings.NewReader(`{"repo_url":"https://example.com/nope"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestProbeShortCircuitsOnAStoredMap(t *testing.T) {
	s, ts := testServer(t)
	s.Resolve = func(url string) (string, string, string, error) {
		canonical, name, err := scan.NormalizeURL(url)
		return canonical, name, "aaa111", err
	}
	s.Scan = func(url, _ string) (*scan.Result, error) {
		return &scan.Result{RepositoryURL: url, Name: "notes", Commit: "aaa111",
			ScannedAt: time.Now().UTC()}, nil
	}
	postAnalyze(t, ts, `{"repo_url":"https://github.com/acme/notes"}`) // warm the store

	s.Scan = func(string, string) (*scan.Result, error) {
		t.Error("a probe on an already-mapped commit must not rescan")
		return nil, fmt.Errorf("unreachable")
	}
	done := lastEvent(t, runJob(t, ts, "/jobs/probe", `{"repo_url":"https://github.com/acme/notes"}`))
	if done.Stage != "done" || done.Map == nil {
		t.Fatalf("done = %+v, want the stored map", done)
	}
	// No recommendation means no gate: there is no LLM run left to configure.
	if done.Recommendation != nil {
		t.Error("a cache hit must not open the model gate")
	}
}

func TestProbeCacheExpires(t *testing.T) {
	s := &Server{}
	res := &scan.Result{RepositoryURL: "https://github.com/acme/notes"}
	s.storeProbe("live", res)
	if s.readProbe("live") != res {
		t.Fatal("a fresh probe should be reusable")
	}
	// Reading must not consume: a failed analyze is exactly when the user
	// retries, and the scan is still good.
	if s.readProbe("live") != res {
		t.Error("a second read must still hit so a retry does not rescan")
	}
	if s.readProbe("never-existed") != nil {
		t.Error("unknown ids must miss")
	}

	s.storeProbe("stale", res)
	s.probeMu.Lock()
	s.probes["stale"] = probeEntry{res: res, expires: time.Now().Add(-time.Second)}
	s.probeMu.Unlock()
	if s.readProbe("stale") != nil {
		t.Error("an expired probe must miss so analyze rescans")
	}
}

func TestProbeCacheHoldsNoSecrets(t *testing.T) {
	s := &Server{}
	s.storeProbe("id", &scan.Result{RepositoryURL: "https://github.com/acme/notes"})
	s.probeMu.Lock()
	defer s.probeMu.Unlock()
	// probeEntry is scan output plus a deadline, by construction. Marshalling
	// it proves nothing key-shaped rides along.
	data, err := json.Marshal(s.probes["id"].res)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.ToLower(string(data)), "api_key") {
		t.Errorf("probe cache entry mentions a key: %s", data)
	}
}

// Compile-time reminder that the analyze seam keeps its routing options.
var _ func(context.Context, *scan.Result, analyzerclient.LLMOpts) (*analysis.Map, []string, error) = (Server{}).Analyze

func TestProbeRecommendationFollowsTheHost(t *testing.T) {
	s, ts := testServer(t)
	s.RepoMeta = func(string) (string, int64, error) { return "", 0, fmt.Errorf("skip") }
	s.Host = func() catalog.Capabilities { return catalog.Capabilities{RAMGB: 8, Device: "cpu"} }
	s.Scan = func(url, _ string) (*scan.Result, error) {
		return &scan.Result{RepositoryURL: url, Name: "big",
			Stats: scan.Stats{SourceFiles: 9000, TopLevelDirs: []string{"a", "b", "c"}}}, nil
	}
	rec := lastEvent(t, runJob(t, ts, "/jobs/probe", `{"repo_url":"https://github.com/acme/notes"}`)).Recommendation
	if rec == nil {
		t.Fatal("no recommendation")
	}
	entry := catalog.Find(rec.ModelID)
	if entry == nil || entry.Kind != catalog.KindRemote {
		t.Errorf("a huge repo on an 8 GB CPU box was offered %q, want a remote model", rec.ModelID)
	}
}

func TestAnalyzeAtCapacityKeepsTheProbe(t *testing.T) {
	s, ts := testServer(t)
	s.RepoMeta = func(string) (string, int64, error) { return "", 0, fmt.Errorf("skip") }
	probeID := lastEvent(t, runJob(t, ts, "/jobs/probe",
		`{"repo_url":"https://github.com/acme/notes"}`)).ProbeID

	// Drain every analyze slot so the next enqueue 429s.
	for s.acquireAnalyze() {
	}
	body := fmt.Sprintf(`{"repo_url":"https://github.com/acme/notes","probe_id":%q}`, probeID)
	resp, err := http.Post(ts.URL+"/jobs/analyze", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", resp.StatusCode)
	}
	// A rejected request must not have eaten the user's probe.
	if s.readProbe(probeID) == nil {
		t.Error("a 429 consumed the probe; the retry would rescan for no reason")
	}
	for len(s.analyzeSlots) > 0 {
		s.releaseAnalyze()
	}
}
