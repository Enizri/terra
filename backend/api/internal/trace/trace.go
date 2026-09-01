// Package trace fans out live preview request spans to map subscribers.
package trace

import (
	"crypto/rand"
	"encoding/hex"
	"path"
	"strings"
	"sync"
	"time"
)

// IngestToken is a per-process secret handed to previewed apps' trace hooks.
// It authorizes POST /traces/ingest and nothing else, so untrusted repo code
// never sees the real TERRA_TOKEN.
var IngestToken = sync.OnceValue(func() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("trace: cannot generate ingest token: " + err.Error())
	}
	return hex.EncodeToString(b[:])
})

// Span is one observed request against a previewed app.
type Span struct {
	Repo   string    `json:"repo"` // normalized repository URL
	Time   time.Time `json:"time"`
	Method string    `json:"method"`
	Path   string    `json:"path"`
	Status int       `json:"status"`
	DurMS  int64     `json:"dur_ms"`
	// Kind is "edge", "server", or "client". Empty means edge.
	Kind string `json:"kind,omitempty"`
}

const keep = 256

var assetExts = map[string]bool{
	".js": true, ".mjs": true, ".ts": true, ".tsx": true, ".jsx": true,
	".css": true, ".map": true, ".svg": true, ".png": true, ".jpg": true,
	".jpeg": true, ".gif": true, ".webp": true, ".ico": true,
	".woff": true, ".woff2": true, ".ttf": true, ".otf": true,
}

// WorthKeeping reports whether path is useful for map animation (not asset noise).
func WorthKeeping(urlPath string) bool {
	for _, prefix := range []string{"/__terra/", "/@", "/node_modules/", "/src/", "/assets/"} {
		if strings.HasPrefix(urlPath, prefix) {
			return false
		}
	}
	if strings.Contains(urlPath, "hot-update") {
		return false
	}
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

// maxRepos bounds the number of per-repo rings: any token-holder can mint new
// repo keys via /traces/ingest, and a long-running server would leak forever.
const maxRepos = 64

// Publish records a span and fans it out. Slow subscribers drop.
func Publish(span Span) {
	mu.Lock()
	defer mu.Unlock()
	if _, ok := recent[span.Repo]; !ok && len(recent) >= maxRepos {
		// Evict an arbitrary ring (map order); LRU if it ever matters.
		for k := range recent {
			delete(recent, k)
			break
		}
	}
	ring := recent[span.Repo]
	ring = append(ring, span)
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

// Subscribe returns ring history plus a channel of future spans for repo.
// cancel closes the channel and must be called.
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
