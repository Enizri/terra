package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/Enizri/terra/internal/catalog"
	"github.com/Enizri/terra/internal/config"
	"github.com/Enizri/terra/internal/graph"
	"github.com/Enizri/terra/internal/job"
	"github.com/Enizri/terra/internal/scan"
	"github.com/Enizri/terra/internal/store"
)

// leakKey is deliberately distinctive so a substring search cannot miss it.
const leakKey = "sk-test-LEAK-0000"

func TestResolveModel(t *testing.T) {
	cfg := &config.Config{LocalLLMURL: "http://localhost:8020"}

	local := resolveModel(cfg, catalog.Find("local-qwen2.5-1.5b"), "")
	if !local.Local || local.HFID != "Qwen/Qwen2.5-1.5B-Instruct" {
		t.Errorf("local selection = %+v", local)
	}
	if local.Opts.BaseURL != "http://localhost:8020" || local.Opts.Model != local.HFID {
		t.Errorf("local routing = %+v", local.Opts)
	}
	if local.Opts.APIKey != "" {
		t.Error("a local model must never carry a key")
	}

	remote := resolveModel(cfg, catalog.Find("openai-gpt-5.4-mini"), leakKey)
	if remote.Local || remote.Opts.BaseURL != "https://api.openai.com/v1" ||
		remote.Opts.Model != "gpt-5.4-mini" || remote.Opts.APIKey != leakKey {
		t.Errorf("remote selection = %+v", remote)
	}

	// No entry means no routing: the analyzer's own environment wins.
	if zero := resolveModel(cfg, nil, leakKey); zero.Opts != (graph.LLMOpts{}) {
		t.Errorf("nil entry produced routing: %+v", zero.Opts)
	}
}

func TestEnqueueAnalyzeRejectsBadModelSelections(t *testing.T) {
	_, ts := testServer(t)
	cases := []struct {
		name, body string
	}{
		{"unknown model id", `{"repo_url":"https://github.com/acme/notes","model_id":"does-not-exist"}`},
		{"remote without a key", `{"repo_url":"https://github.com/acme/notes","model_id":"openai-gpt-5.4"}`},
		{"remote with a blank key", `{"repo_url":"https://github.com/acme/notes","model_id":"openai-gpt-5.4","api_key":"   "}`},
	}
	for _, tc := range cases {
		resp, err := http.Post(ts.URL+"/jobs/analyze", "application/json", strings.NewReader(tc.body))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", tc.name, resp.StatusCode)
		}
	}
}

func TestAnalyzeWithoutAModelIDKeepsTheEnvFallback(t *testing.T) {
	s, ts := testServer(t)
	var got graph.LLMOpts
	s.Analyze = func(ctx context.Context, res *scan.Result, opts graph.LLMOpts) (*graph.Map, []string, error) {
		got = opts
		return &graph.Map{Components: []graph.Component{{ID: "a"}}}, nil, nil
	}
	events := runJob(t, ts, "/jobs/analyze", `{"repo_url":"https://github.com/acme/notes"}`)
	if got != (graph.LLMOpts{}) {
		t.Errorf("unrouted analyze passed %+v, want zero options", got)
	}
	if want := "fetch,scan,analyze,store,done"; strings.Join(stages(events), ",") != want {
		t.Errorf("stages = %v, want %s", stages(events), want)
	}
}

func TestAnalyzeReusesAProbeScan(t *testing.T) {
	s, ts := testServer(t)
	s.RepoMeta = func(string) (string, int64, error) { return "", 0, fmt.Errorf("skip") }
	probeID := lastEvent(t, runJob(t, ts, "/jobs/probe",
		`{"repo_url":"https://github.com/acme/notes"}`)).ProbeID
	if probeID == "" {
		t.Fatal("probe produced no id")
	}

	s.Scan = func(string, string) (*scan.Result, error) {
		t.Error("analyze must reuse the probe's scan, not run its own")
		return nil, fmt.Errorf("unreachable")
	}
	s.Resolve = func(string) (string, string, string, error) {
		t.Error("analyze must not re-resolve HEAD when reusing a probe")
		return "", "", "", fmt.Errorf("unreachable")
	}
	events := runJob(t, ts, "/jobs/analyze",
		fmt.Sprintf(`{"repo_url":"https://github.com/acme/notes","probe_id":%q}`, probeID))
	if want := "scan,analyze,store,done"; strings.Join(stages(events), ",") != want {
		t.Fatalf("stages = %v, want %s (no fetch: the probe already did it)", stages(events), want)
	}
}

func TestAnalyzeRescansWhenTheProbeExpired(t *testing.T) {
	_, ts := testServer(t)
	events := runJob(t, ts, "/jobs/analyze",
		`{"repo_url":"https://github.com/acme/notes","probe_id":"long-gone"}`)
	if len(events) == 0 || events[0].Stage != "fetch" {
		t.Fatalf("events = %+v, want a fetch stage", events)
	}
	if !strings.Contains(events[0].Label, "rescanning") {
		t.Errorf("fetch label = %q, want it to mention the rescan", events[0].Label)
	}
	if lastEvent(t, events).Stage != "done" {
		t.Errorf("an expired probe must still complete: %v", stages(events))
	}
}

func TestLocalModelRunsEnsureModelFirst(t *testing.T) {
	s, ts := testServer(t)
	order := []string{}
	s.EnsureModel = func(ctx context.Context, hfID string, emit func(job.Event)) error {
		order = append(order, "ensure:"+hfID)
		emit(job.Event{Stage: "ensure_model", Label: "Loading " + hfID})
		return nil
	}
	s.Analyze = func(ctx context.Context, res *scan.Result, opts graph.LLMOpts) (*graph.Map, []string, error) {
		order = append(order, "analyze:"+opts.Model)
		return &graph.Map{Components: []graph.Component{{ID: "a"}}}, nil, nil
	}
	events := runJob(t, ts, "/jobs/analyze",
		`{"repo_url":"https://github.com/acme/notes","model_id":"local-qwen2.5-1.5b"}`)

	want := []string{"ensure:Qwen/Qwen2.5-1.5B-Instruct", "analyze:Qwen/Qwen2.5-1.5B-Instruct"}
	if strings.Join(order, ",") != strings.Join(want, ",") {
		t.Errorf("order = %v, want %v", order, want)
	}
	if !strings.Contains(strings.Join(stages(events), ","), "ensure_model,analyze") {
		t.Errorf("stages = %v, want ensure_model before analyze", stages(events))
	}
}

func TestRemoteModelSkipsEnsureModel(t *testing.T) {
	s, ts := testServer(t)
	s.EnsureModel = func(context.Context, string, func(job.Event)) error {
		t.Error("a remote model has nothing to load on this host")
		return nil
	}
	runJob(t, ts, "/jobs/analyze",
		`{"repo_url":"https://github.com/acme/notes","model_id":"openai-gpt-5.4-mini","api_key":"`+leakKey+`"}`)
}

// The API key is the one thing in this pipeline that must not be observable.
// Analyze failing is the dangerous case: analyzer errors are echoed verbatim
// into an event label.
func TestAPIKeyNeverReachesJobEventsOrTheStore(t *testing.T) {
	s, ts := testServer(t)
	var seen graph.LLMOpts
	s.Analyze = func(ctx context.Context, res *scan.Result, opts graph.LLMOpts) (*graph.Map, []string, error) {
		seen = opts
		// An unhelpful provider echoing the request back at us.
		return nil, nil, fmt.Errorf("analyzer: 401 unauthorized for request %s", opts.APIKey)
	}
	events := runJob(t, ts, "/jobs/analyze",
		`{"repo_url":"https://github.com/acme/notes","model_id":"openai-gpt-5.4","api_key":"`+leakKey+`"}`)

	if seen.APIKey != leakKey {
		t.Fatalf("the key never reached the analyzer (%q) — this test would pass vacuously", seen.APIKey)
	}
	for _, ev := range events {
		data, err := json.Marshal(ev)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), leakKey) {
			t.Errorf("api key leaked into a job event: %s", data)
		}
	}
	// The probe cache and the store are the two places a key could linger.
	s.probeMu.Lock()
	for id, entry := range s.probes {
		data, _ := json.Marshal(entry.res)
		if strings.Contains(string(data), leakKey) {
			t.Errorf("api key leaked into probe %s", id)
		}
	}
	s.probeMu.Unlock()
	if list, err := store.List(s.DB); err == nil {
		data, _ := json.Marshal(list)
		if strings.Contains(string(data), leakKey) {
			t.Errorf("api key leaked into the store: %s", data)
		}
	}
}

func TestAskRoutesTheSessionModel(t *testing.T) {
	s, ts := testServer(t)
	var payload map[string]any
	s.RunTask = func(ctx context.Context, name string, p any) (json.RawMessage, error) {
		payload, _ = p.(map[string]any)
		return json.RawMessage(`{"answer":"ok"}`), nil
	}
	runJob(t, ts, "/jobs/ask",
		`{"repo_url":"https://github.com/acme/notes","question":"what?","model_id":"openai-gpt-5.4-mini","api_key":"`+leakKey+`"}`)

	if payload["model"] != "gpt-5.4-mini" || payload["base_url"] != "https://api.openai.com/v1" {
		t.Errorf("ask payload routing = %+v", payload)
	}
	if payload["api_key"] != leakKey {
		t.Error("ask must forward the key to the analyzer")
	}
}

// Ask used to ignore a bad pick silently and fail deep inside the provider.
func TestEnqueueAskRejectsBadModelSelections(t *testing.T) {
	_, ts := testServer(t)
	base := `{"repo_url":"https://github.com/acme/notes","question":"what?"`
	cases := []struct {
		name, body string
	}{
		{"unknown model id", base + `,"model_id":"does-not-exist"}`},
		{"remote without a key", base + `,"model_id":"openai-gpt-5.4"}`},
		{"remote with a blank key", base + `,"model_id":"openai-gpt-5.4","api_key":"   "}`},
	}
	for _, tc := range cases {
		for _, path := range []string{"/jobs/ask", "/ask"} {
			resp, err := http.Post(ts.URL+path, "application/json", strings.NewReader(tc.body))
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			if resp.StatusCode != http.StatusBadRequest {
				t.Errorf("%s %s: status = %d, want 400", path, tc.name, resp.StatusCode)
			}
		}
	}
}

// The sidecar may have been switched since analyze ran.
func TestAskLoadsALocalModelBeforeAnswering(t *testing.T) {
	s, ts := testServer(t)
	order := []string{}
	s.EnsureModel = func(ctx context.Context, hfID string, emit func(job.Event)) error {
		order = append(order, "ensure:"+hfID)
		emit(job.Event{Stage: "ensure_model", Label: "Loading " + hfID})
		return nil
	}
	s.RunTask = func(ctx context.Context, name string, p any) (json.RawMessage, error) {
		order = append(order, "qa")
		return json.RawMessage(`{"answer":"ok"}`), nil
	}
	events := runJob(t, ts, "/jobs/ask",
		`{"repo_url":"https://github.com/acme/notes","question":"what?","model_id":"local-qwen2.5-1.5b"}`)

	if want := "ensure:Qwen/Qwen2.5-1.5B-Instruct,qa"; strings.Join(order, ",") != want {
		t.Errorf("order = %v, want %s", order, want)
	}
	if !strings.Contains(strings.Join(stages(events), ","), "ensure_model") {
		t.Errorf("stages = %v, want an ensure_model stage", stages(events))
	}
}

func TestAskWithARemoteModelSkipsEnsureModel(t *testing.T) {
	s, ts := testServer(t)
	s.EnsureModel = func(context.Context, string, func(job.Event)) error {
		t.Error("a remote model has nothing to load on this host")
		return nil
	}
	s.RunTask = func(context.Context, string, any) (json.RawMessage, error) {
		return json.RawMessage(`{"answer":"ok"}`), nil
	}
	runJob(t, ts, "/jobs/ask",
		`{"repo_url":"https://github.com/acme/notes","question":"what?","model_id":"openai-gpt-5.4-mini","api_key":"`+leakKey+`"}`)
}

func TestAskWithoutAModelIDSendsNoRouting(t *testing.T) {
	s, ts := testServer(t)
	var payload map[string]any
	s.RunTask = func(ctx context.Context, name string, p any) (json.RawMessage, error) {
		payload, _ = p.(map[string]any)
		return json.RawMessage(`{"answer":"ok"}`), nil
	}
	runJob(t, ts, "/jobs/ask", `{"repo_url":"https://github.com/acme/notes","question":"what?"}`)
	for _, key := range []string{"model", "base_url", "api_key"} {
		if _, ok := payload[key]; ok {
			t.Errorf("unrouted ask sent %q; the analyzer env must decide", key)
		}
	}
}

func TestAskErrorsAreScrubbed(t *testing.T) {
	s, ts := testServer(t)
	s.RunTask = func(ctx context.Context, name string, p any) (json.RawMessage, error) {
		return nil, fmt.Errorf("analyzer: provider rejected key %s", leakKey)
	}
	events := runJob(t, ts, "/jobs/ask",
		`{"repo_url":"https://github.com/acme/notes","question":"what?","model_id":"openai-gpt-5.4-mini","api_key":"`+leakKey+`"}`)
	for _, ev := range events {
		data, _ := json.Marshal(ev)
		if strings.Contains(string(data), leakKey) {
			t.Errorf("api key leaked into an ask event: %s", data)
		}
	}
}

// The sidecar base URL must survive the analyzer's /v1 normalization.
func TestAskRoutesALocalModel(t *testing.T) {
	s, ts := testServer(t)
	s.EnsureModel = func(context.Context, string, func(job.Event)) error { return nil }
	var payload map[string]any
	s.RunTask = func(ctx context.Context, name string, p any) (json.RawMessage, error) {
		payload, _ = p.(map[string]any)
		return json.RawMessage(`{"answer":"ok"}`), nil
	}
	runJob(t, ts, "/jobs/ask",
		`{"repo_url":"https://github.com/acme/notes","question":"what?","model_id":"local-qwen2.5-1.5b"}`)

	if payload["model"] != "Qwen/Qwen2.5-1.5B-Instruct" {
		t.Errorf("model = %v", payload["model"])
	}
	base, _ := payload["base_url"].(string)
	if base != "http://localhost:8020" {
		t.Errorf("base_url = %q, want the bare sidecar URL (the analyzer appends /v1)", base)
	}
	if strings.Contains(base, "/v1") {
		t.Error("base_url already ends in /v1; the analyzer would make it /v1/v1")
	}
	if _, ok := payload["api_key"]; ok {
		t.Error("a local model must not send a key")
	}
}
