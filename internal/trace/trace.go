// Package trace is the runtime plane's span wire: live previews publish one
// span per proxied request, and map clients subscribe to watch the request
// path light up. In-process fan-out only — an OTLP collector replaces the
// hub when sandboxes emit real telemetry.
package trace

import (
	"sync"
	"time"
)

// Span is one observed request against a previewed app.
type Span struct {
	Repo   string    `json:"repo"` // normalized repository URL
	Time   time.Time `json:"time"`
	Method string    `json:"method"`
	Path   string    `json:"path"`
	Status int       `json:"status"`
	DurMS  int64     `json:"dur_ms"`
	// Kind says where the span was observed: "edge" (Terra's proxy),
	// "server" (inside the app's Node process), "client" (the app calling
	// out). Empty means edge, from before kinds existed.
	Kind string `json:"kind,omitempty"`
}

// keep is the ring size per repo: enough for a demo session's history,
// small enough to never matter.
const keep = 256

var (
	mu     sync.Mutex
	nextID int
	subs   = map[int]subscriber{}
	recent = map[string][]Span{}
)

type subscriber struct {
	repo string
	ch   chan Span
}

// Publish records a span and fans it out. Slow subscribers drop spans
// rather than block the preview's request path.
func Publish(s Span) {
	mu.Lock()
	defer mu.Unlock()
	r := append(recent[s.Repo], s)
	if len(r) > keep {
		r = r[len(r)-keep:]
	}
	recent[s.Repo] = r
	for _, sub := range subs {
		if sub.repo != s.Repo {
			continue
		}
		select {
		case sub.ch <- s:
		default:
		}
	}
}

// Subscribe returns a channel of future spans for one repo, plus everything
// already in the ring so a late-connecting map sees the session's history.
// cancel must be called; it closes the channel.
func Subscribe(repo string) (history []Span, ch <-chan Span, cancel func()) {
	c := make(chan Span, 64)
	mu.Lock()
	defer mu.Unlock()
	id := nextID
	nextID++
	subs[id] = subscriber{repo: repo, ch: c}
	history = append([]Span(nil), recent[repo]...)
	return history, c, func() {
		mu.Lock()
		defer mu.Unlock()
		if _, ok := subs[id]; ok {
			delete(subs, id)
			close(c)
		}
	}
}
