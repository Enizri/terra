package analyze

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/Enizri/terra/backend/api/internal/scan"
)

func TestProbeCache(t *testing.T) {
	res := &scan.Result{RepositoryURL: "https://github.com/acme/notes"}
	cache := NewProbeCache(time.Minute)
	cache.Store("live", res)
	if cache.Read("live") != res {
		t.Fatal("a fresh probe should be reusable")
	}
	if cache.Read("live") != res {
		t.Fatal("reading a probe must not consume it")
	}
	if cache.Read("missing") != nil {
		t.Fatal("unknown ids must miss")
	}

	expired := NewProbeCache(-time.Second)
	expired.Store("stale", res)
	if expired.Read("stale") != nil {
		t.Fatal("expired probes must miss")
	}

	data, err := json.Marshal(cache.Results())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.ToLower(string(data)), "api_key") {
		t.Fatalf("probe cache mentions a key: %s", data)
	}
}
