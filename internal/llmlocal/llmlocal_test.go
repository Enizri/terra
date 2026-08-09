package llmlocal

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Enizri/terra/internal/job"
)

// swapPoll shortens the poll interval; real polling is 2s and tests would
// otherwise spend minutes waiting. The returned func restores it.
func swapPoll(d time.Duration) func() {
	old := pollEvery
	pollEvery = d
	return func() { pollEvery = old }
}

// fakeSidecar serves /admin/status from states in order (the last repeats)
// and records every /admin/load it is asked for.
type fakeSidecar struct {
	mu      sync.Mutex
	states  []status
	loads   []string
	cancels int
	// loadStatus is the HTTP status /admin/load replies with.
	loadStatus int
}

func (f *fakeSidecar) server(t *testing.T) string {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /admin/status", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		st := f.states[0]
		if len(f.states) > 1 {
			f.states = f.states[1:]
		}
		json.NewEncoder(w).Encode(st)
	})
	mux.HandleFunc("POST /admin/load", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ModelID string `json:"model_id"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		f.loads = append(f.loads, body.ModelID)
		f.mu.Unlock()
		code := f.loadStatus
		if code == 0 {
			code = http.StatusOK
		}
		w.WriteHeader(code)
		w.Write([]byte(`{"detail":"nope"}`))
	})
	mux.HandleFunc("POST /admin/cancel", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.cancels++
		f.mu.Unlock()
		w.Write([]byte(`{"cancelled":"","state":"empty"}`))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv.URL
}

func collect() (func(job.Event), *[]job.Event) {
	var events []job.Event
	return func(ev job.Event) { events = append(events, ev) }, &events
}

func TestEnsureModelIsANoopWhenAlreadyServing(t *testing.T) {
	f := &fakeSidecar{states: []status{{ModelID: "Qwen/A", State: "ready"}}}
	emit, events := collect()
	if err := EnsureModel(context.Background(), f.server(t), "Qwen/A", emit); err != nil {
		t.Fatal(err)
	}
	if len(*events) != 0 {
		t.Errorf("nothing to do should emit nothing, got %+v", *events)
	}
	if len(f.loads) != 0 {
		t.Errorf("nothing to do should not reload, got %v", f.loads)
	}
}

func TestEnsureModelLoadsAndWaits(t *testing.T) {
	defer swapPoll(10 * time.Millisecond)()
	f := &fakeSidecar{states: []status{
		{ModelID: "Qwen/Old", State: "ready"},
		{ModelID: "Qwen/New", State: "loading"},
		{ModelID: "Qwen/New", State: "loading"},
		{ModelID: "Qwen/New", State: "ready"},
	}}
	emit, events := collect()
	if err := EnsureModel(context.Background(), f.server(t), "Qwen/New", emit); err != nil {
		t.Fatal(err)
	}
	if len(f.loads) != 1 || f.loads[0] != "Qwen/New" {
		t.Errorf("loads = %v", f.loads)
	}
	if len(*events) == 0 {
		t.Fatal("a switch must report progress")
	}
	for _, ev := range *events {
		if ev.Stage != "ensure_model" {
			t.Errorf("unexpected stage %q", ev.Stage)
		}
	}
	if last := (*events)[len(*events)-1]; !strings.Contains(last.Label, "ready") {
		t.Errorf("last label = %q, want a ready message", last.Label)
	}
}

func TestEnsureModelSurfacesALoadFailure(t *testing.T) {
	defer swapPoll(10 * time.Millisecond)()
	f := &fakeSidecar{states: []status{
		{State: "empty"},
		{ModelID: "Qwen/Big", State: "error", Error: "out of memory"},
	}}
	emit, _ := collect()
	err := EnsureModel(context.Background(), f.server(t), "Qwen/Big", emit)
	if err == nil || !strings.Contains(err.Error(), "out of memory") {
		t.Fatalf("err = %v, want the sidecar's reason", err)
	}
	if !strings.Contains(err.Error(), "smaller local model") {
		t.Errorf("err = %q, want a way forward", err)
	}
}

func TestEnsureModelTolerates409AndKeepsPolling(t *testing.T) {
	defer swapPoll(10 * time.Millisecond)()
	f := &fakeSidecar{
		loadStatus: http.StatusConflict,
		states: []status{
			{State: "empty"},
			{ModelID: "Qwen/New", State: "loading"},
			{ModelID: "Qwen/New", State: "ready"},
		},
	}
	emit, _ := collect()
	if err := EnsureModel(context.Background(), f.server(t), "Qwen/New", emit); err != nil {
		t.Fatalf("a concurrent load already in flight is not an error: %v", err)
	}
}

func TestEnsureModelStopsOnCancel(t *testing.T) {
	defer swapPoll(10 * time.Millisecond)()
	f := &fakeSidecar{states: []status{{ModelID: "Qwen/New", State: "loading"}}}
	ctx, cancel := context.WithCancel(context.Background())
	emit, _ := collect()
	go func() {
		time.Sleep(30 * time.Millisecond)
		cancel()
	}()
	if err := EnsureModel(ctx, f.server(t), "Qwen/New", emit); err == nil {
		t.Error("cancel must abort the wait")
	}
	// Otherwise the abandoned download still installs itself, and the next
	// pick queues behind it.
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.cancels != 1 {
		t.Errorf("cancels = %d, want the sidecar told to abandon the load", f.cancels)
	}
}

func TestEnsureModelExplainsADeadSidecar(t *testing.T) {
	emit, _ := collect()
	err := EnsureModel(context.Background(), "http://127.0.0.1:1", "Qwen/A", emit)
	if err == nil || !strings.Contains(err.Error(), "make run-llm") {
		t.Errorf("err = %v, want a start-it hint", err)
	}
}

// A job that finds the sidecar already loading its model issues no load of its
// own. If that load is then cancelled the sidecar goes back to empty with
// nothing in flight, and waiting would burn the whole analyze timeout.
func TestEnsureModelTakesOverAnAbandonedLoad(t *testing.T) {
	defer swapPoll(10 * time.Millisecond)()
	f := &fakeSidecar{
		states: []status{
			{ModelID: "Qwen/New", State: "loading"},
			{State: "empty"},
			{ModelID: "Qwen/New", State: "loading"},
			{ModelID: "Qwen/New", State: "ready"},
		},
	}
	emit, _ := collect()
	if err := EnsureModel(context.Background(), f.server(t), "Qwen/New", emit); err != nil {
		t.Fatalf("EnsureModel should recover an abandoned load: %v", err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.loads) != 1 || f.loads[0] != "Qwen/New" {
		t.Errorf("loads = %v, want exactly one take-over load of Qwen/New", f.loads)
	}
}

// Taking over once is recovery; taking over forever is a spin loop.
func TestEnsureModelGivesUpIfTheLoadKeepsBeingDropped(t *testing.T) {
	defer swapPoll(10 * time.Millisecond)()
	f := &fakeSidecar{states: []status{{ModelID: "Qwen/New", State: "loading"}, {State: "empty"}}}
	emit, _ := collect()
	err := EnsureModel(context.Background(), f.server(t), "Qwen/New", emit)
	if err == nil || !strings.Contains(err.Error(), "keeps dropping") {
		t.Fatalf("err = %v, want a give-up error rather than a hang", err)
	}
}
