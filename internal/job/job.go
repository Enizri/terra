// Package job is a process-local queue for long-running Terra tasks.
package job

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/Enizri/terra/internal/analysis"
	"github.com/Enizri/terra/internal/recommend"
)

// Event is one progress update (NDJSON / SSE wire shape).
//
// Nothing secret goes here: events are replayed to every subscriber and to
// the browser. In particular a request's API key must never reach an Event,
// not even inside Label.
type Event struct {
	Stage  string        `json:"stage"`
	Label  string        `json:"label,omitempty"`
	Map    *analysis.Map `json:"map,omitempty"`
	Answer string        `json:"answer,omitempty"`

	// Probe job only: the handle analyze reuses, plus what the picker shows.
	ProbeID        string                    `json:"probe_id,omitempty"`
	Repo           *recommend.RepoInfo       `json:"repo,omitempty"`
	Recommendation *recommend.Recommendation `json:"recommendation,omitempty"`
}

// RunFunc runs job work. emit is concurrency-safe; ctx cancels on Cancel or finish.
type RunFunc func(ctx context.Context, emit func(Event))

// Hub holds in-flight and recently finished jobs for one process.
type Hub struct {
	mu   sync.Mutex
	jobs map[string]*Job
	wg   sync.WaitGroup
}

// NewHub returns an empty hub.
func NewHub() *Hub {
	return &Hub{jobs: map[string]*Job{}}
}

// Start enqueues run and returns a live Job.
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
	h.wg.Add(1)
	go func() {
		defer h.wg.Done()
		defer cancel()
		defer func() {
			if p := recover(); p != nil {
				log.Printf("job %s panicked: %v", id, p)
				j.emit(Event{Stage: "error", Label: fmt.Sprintf("internal error: %v", p)})
			}
			j.finish()
			// Keep finished jobs (with their full event history, map included)
			// around briefly for reconnect replay, then drop them — the hub
			// would otherwise grow for the process lifetime.
			time.AfterFunc(10*time.Minute, func() {
				h.mu.Lock()
				delete(h.jobs, id)
				h.mu.Unlock()
			})
		}()
		run(ctx, j.emit)
	}()
	return j
}

// Wait blocks until every job started so far has finished. For shutdown and tests.
func (h *Hub) Wait() {
	h.wg.Wait()
}

// Get returns a job by id, or nil.
func (h *Hub) Get(id string) *Job {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.jobs[id]
}

// Job is one background unit of work with a replayable event log.
type Job struct {
	ID string

	mu      sync.Mutex
	events  []Event
	done    bool
	subs    map[int]chan Event
	nextSub int
	cancel  context.CancelFunc
}

// Cancel asks the worker to stop. Finished jobs are a no-op.
func (j *Job) Cancel() {
	j.cancel()
}

// Subscribe replays history then yields live events until the job finishes.
// The returned cancel unsubscribes only; it does not cancel the job.
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
			// Drop on backpressure; history covers reconnect.
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
	// crypto/rand.Read never returns an error (it crashes the program if the
	// source fails) — a fallback constant here would collide job IDs.
	rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
