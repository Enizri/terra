// Package trace is the runtime plane's span wire: live previews publish one
// span per proxied request, and map clients subscribe to watch the request
// path light up. In-process fan-out only — an OTLP collector replaces the
// hub when sandboxes emit real telemetry.
package trace

import (
	"path"
	"strings"
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

// assetExts is dev-server noise: shipping these is not the app acting.
var assetExts = map[string]bool{
	".js": true, ".mjs": true, ".ts": true, ".tsx": true, ".jsx": true,
	".css": true, ".map": true, ".svg": true, ".png": true, ".jpg": true,
	".jpeg": true, ".gif": true, ".webp": true, ".ico": true,
	".woff": true, ".woff2": true, ".ttf": true, ".otf": true,
}

// WorthKeeping reports whether a request path is worth lighting up on the
// map. Shared by the edge proxy and in-process ingest so asset noise never
// enters the ring. RPC paths with dots (memos.api.v1.MemoService/...) survive:
// only known asset extensions are dropped, not "has a dot".
func WorthKeeping(urlPath string) bool {
	for _, prefix := range []string{"/__terra/", "/@", "/node_modules/", "/src/", "/assets/"} {
		if strings.HasPrefix(urlPath, prefix) {
			return false
		}
	}
	if strings.Contains(urlPath, "hot-update") {
		return false
	}
	// Bare document shells from Vite are not the app acting.
	if urlPath == "/index.html" {
		return false
	}
	return !assetExts[strings.ToLower(path.Ext(urlPath))]
}

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
func Publish(span Span) {
	mu.Lock()
	defer mu.Unlock()
	ring := append(recent[span.Repo], span)
	if len(ring) > keep {
		ring = ring[len(ring)-keep:]
	}
	recent[span.Repo] = ring
	for _, sub := range subs {
		if sub.repo != span.Repo {
			continue
		}
		select {
		case sub.ch <- span:
		default:
		}
	}
}

// Subscribe returns a channel of future spans for one repo, plus everything
// already in the ring so a late-connecting map sees the session's history.
// cancel must be called; it closes the channel.
func Subscribe(repo string) (history []Span, ch <-chan Span, cancel func()) {
	live := make(chan Span, 64)
	mu.Lock()
	defer mu.Unlock()
	id := nextID
	nextID++
	subs[id] = subscriber{repo: repo, ch: live}
	history = append([]Span(nil), recent[repo]...)
	return history, live, func() {
		mu.Lock()
		defer mu.Unlock()
		if _, ok := subs[id]; ok {
			delete(subs, id)
			close(live)
		}
	}
}
