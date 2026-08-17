package analyze

import (
	"sync"
	"time"

	"github.com/Enizri/terra/backend/api/internal/scan"
)

const ProbeTTL = 15 * time.Minute

type probeEntry struct {
	res     *scan.Result
	expires time.Time
}

// ProbeCache keeps scan-only probe results long enough for model selection and retries.
type ProbeCache struct {
	mu      sync.Mutex
	entries map[string]probeEntry
	ttl     time.Duration
}

func NewProbeCache(ttl time.Duration) *ProbeCache {
	return &ProbeCache{entries: map[string]probeEntry{}, ttl: ttl}
}

func (c *ProbeCache) Store(id string, res *scan.Result) {
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	for key, entry := range c.entries {
		if now.After(entry.expires) {
			delete(c.entries, key)
		}
	}
	c.entries[id] = probeEntry{res: res, expires: now.Add(c.ttl)}
}

// Read does not consume the entry so a failed analyze can retry without rescanning.
func (c *ProbeCache) Read(id string) *scan.Result {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[id]
	if !ok || time.Now().After(entry.expires) {
		return nil
	}
	return entry.res
}

// Results returns a snapshot for security checks without exposing cache internals.
func (c *ProbeCache) Results() []*scan.Result {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]*scan.Result, 0, len(c.entries))
	for _, entry := range c.entries {
		out = append(out, entry.res)
	}
	return out
}
