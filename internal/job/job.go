// Package job is a process-local work queue for long-running Terra tasks
// (analyze today, ask next). A job runs in a goroutine, emits stage events,
// and clients subscribe — so the browser HTTP request is not the worker.
package job

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"

	"github.com/Enizri/terra/internal/graph"
)

// Event is one progress line. Shape matches the NDJSON the web already
// consumes from /analyze (stage/label/map); ask jobs put the reply in Answer.
type Event struct {
	Stage  string     `json:"stage"`
	Label  string     `json:"label,omitempty"`
	Map    *graph.Map `json:"map,omitempty"`
	Answer string     `json:"answer,omitempty"`
}

// RunFunc does the work. emit is safe for concurrent use; ctx cancels when
// the job is cancelled or finishes.
type RunFunc func(ctx context.Context, emit func(Event))

// Hub holds in-flight and recently finished jobs for one server process.
type Hub struct {
	mu   sync.Mutex
	jobs map[string]*Job
}

// NewHub returns an empty hub.
func NewHub() *Hub {
	return &Hub{jobs: map[string]*Job{}}
}

// Start enqueues run and returns immediately with a live Job.
func (h *Hub) Start(run RunFunc) *Job {
	id := newID()
	ctx, cancel := context.WithCancel(context.Background())
	j := &Job{
		ID:     id,
		cancel: cancel,
		subs:   map[int]chan Event{},
	}
	h.mu.Lock()
	h.jobs[id] = j
	h.mu.Unlock()
	go func() {
		defer cancel()
		run(ctx, j.emit)
		j.finish()
	}()
	return j
}

// Get returns a job by id, or nil.
func (h *Hub) Get(id string) *Job {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.jobs[id]
}

// Job is one unit of background work with a replayable event log.
type Job struct {
	ID string

	mu      sync.Mutex
	events  []Event
	done    bool
	subs    map[int]chan Event
	nextSub int
	cancel  context.CancelFunc
}

// Cancel asks the worker to stop. Already-finished jobs are a no-op.
func (j *Job) Cancel() {
	j.cancel()
}

// Subscribe replays history then yields live events until the job finishes.
// cancel unsubscribes; it does not cancel the job itself.
func (j *Job) Subscribe() (history []Event, ch <-chan Event, cancel func()) {
	out := make(chan Event, 16)
	j.mu.Lock()
	defer j.mu.Unlock()
	history = append([]Event(nil), j.events...)
	if j.done {
		close(out)
		return history, out, func() {}
	}
	id := j.nextSub
	j.nextSub++
	j.subs[id] = out
	return history, out, func() {
		j.mu.Lock()
		defer j.mu.Unlock()
		if sub, ok := j.subs[id]; ok {
			delete(j.subs, id)
			close(sub)
		}
	}
}

func (j *Job) emit(ev Event) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.done {
		return
	}
	j.events = append(j.events, ev)
	for _, sub := range j.subs {
		select {
		case sub <- ev:
		default:
			// Slow subscriber drops; history still has the event on reconnect.
		}
	}
}

func (j *Job) finish() {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.done {
		return
	}
	j.done = true
	for id, sub := range j.subs {
		close(sub)
		delete(j.subs, id)
	}
}

func newID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		// Process-local uniqueness is enough; panic is worse than a weak id.
		return hex.EncodeToString([]byte("fallback"))
	}
	return hex.EncodeToString(b[:])
}
