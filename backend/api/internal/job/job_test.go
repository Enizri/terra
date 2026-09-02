package job

import (
	"context"
	"testing"
	"time"
)

func TestLateSubscribeGetsFullHistory(t *testing.T) {
	h := NewHub()
	j := h.Start(func(ctx context.Context, emit func(Event)) {
		emit(Event{Stage: "clone", Label: "go"})
		emit(Event{Stage: "done"})
	})
	waitDone(t, j)

	hist, live, cancel := j.Subscribe()
	defer cancel()
	if len(hist) != 2 || hist[0].Stage != "clone" || hist[1].Stage != "done" {
		t.Fatalf("history = %+v", hist)
	}
	select {
	case _, ok := <-live:
		if ok {
			t.Fatal("expected closed channel after finished job")
		}
	case <-time.After(time.Second):
		t.Fatal("channel not closed")
	}
}

func TestLiveSubscribeReceivesEvents(t *testing.T) {
	h := NewHub()
	gate := make(chan struct{})
	j := h.Start(func(ctx context.Context, emit func(Event)) {
		<-gate
		emit(Event{Stage: "analyze"})
		emit(Event{Stage: "done"})
	})
	_, ch, cancel := j.Subscribe()
	defer cancel()
	close(gate)

	var stages []string
	for ev := range ch {
		stages = append(stages, ev.Stage)
	}
	if len(stages) != 2 || stages[0] != "analyze" || stages[1] != "done" {
		t.Fatalf("stages = %v", stages)
	}
}

func TestCancelStopsWorker(t *testing.T) {
	h := NewHub()
	started := make(chan struct{})
	j := h.Start(func(ctx context.Context, emit func(Event)) {
		close(started)
		<-ctx.Done()
		emit(Event{Stage: "error", Label: "cancelled"})
	})
	<-started
	j.Cancel()
	waitDone(t, j)

	hist, _, cancel := j.Subscribe()
	defer cancel()
	if len(hist) == 0 || hist[len(hist)-1].Stage != "error" {
		t.Fatalf("want cancelled error event, got %+v", hist)
	}
}

func TestRetrieveAndToolStagesRoundTrip(t *testing.T) {
	h := NewHub()
	j := h.Start(func(ctx context.Context, emit func(Event)) {
		emit(Event{Stage: "retrieve", Label: "lookup_component"})
		emit(Event{Stage: "tool", Label: "read_snippet"})
		emit(Event{Stage: "done", Answer: "ok"})
	})
	waitDone(t, j)
	hist, _, cancel := j.Subscribe()
	defer cancel()
	if len(hist) != 3 || hist[0].Stage != "retrieve" || hist[1].Stage != "tool" {
		t.Fatalf("history = %+v", hist)
	}
	if hist[0].Label != "lookup_component" || hist[1].Label != "read_snippet" {
		t.Fatalf("labels = %q %q", hist[0].Label, hist[1].Label)
	}
}

func waitDone(t *testing.T, j *Job) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		j.mu.Lock()
		done := j.done
		j.mu.Unlock()
		if done {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("job did not finish")
}
