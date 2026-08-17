package preview

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/Enizri/terra/backend/api/internal/config"
	"github.com/Enizri/terra/backend/api/internal/trace"
)

func TestMergeNodeOptions(t *testing.T) {
	if got := mergeNodeOptions("", "/tmp/hook.js"); got != "--require /tmp/hook.js" {
		t.Errorf("empty existing: %q", got)
	}
	// An app's own NODE_OPTIONS must survive, hook appended.
	if got := mergeNodeOptions("--max-old-space-size=4096", "/tmp/hook.js"); got != "--max-old-space-size=4096 --require /tmp/hook.js" {
		t.Errorf("existing preserved: %q", got)
	}
	// NODE_OPTIONS splits on spaces; a spacey path needs quotes.
	if got := mergeNodeOptions("", "/tmp/my dir/hook.js"); got != `--require "/tmp/my dir/hook.js"` {
		t.Errorf("spacey path: %q", got)
	}
}

func TestTerraPort(t *testing.T) {
	for addr, want := range map[string]string{"": "8080", ":9000": "9000", "localhost:7777": "7777"} {
		c := &config.Config{Addr: addr}
		if got := c.Port(); got != want {
			t.Errorf("Addr=%q: port = %q, want %q", addr, got, want)
		}
	}
}

func TestTraceEnvArmsTheHook(t *testing.T) {
	t.Setenv("NODE_OPTIONS", "")
	t.Setenv("TERRA_TOKEN", "real-api-secret")
	env := traceEnv(&config.Config{Addr: ":9999"}, "https://github.com/acme/notes")
	if len(env) != 4 {
		t.Fatalf("env = %v", env)
	}
	if !strings.HasPrefix(env[0], "NODE_OPTIONS=--require ") {
		t.Errorf("NODE_OPTIONS = %q", env[0])
	}
	// The required path must be absolute: node resolves relative --require
	// against the previewed app's cwd, not Terra's.
	hookPath := strings.TrimPrefix(env[0], "NODE_OPTIONS=--require ")
	if !filepath.IsAbs(strings.Trim(hookPath, `"`)) {
		t.Errorf("hook path %q is not absolute", hookPath)
	}
	if env[1] != "TERRA_TRACE_URL=http://localhost:9999/traces/ingest" {
		t.Errorf("trace url = %q", env[1])
	}
	if env[2] != "TERRA_TRACE_REPO=https://github.com/acme/notes" {
		t.Errorf("trace repo = %q", env[2])
	}
	// The hook token must be the scoped ingest token, never the API token:
	// it is handed to untrusted repo code.
	if env[3] != "TERRA_TRACE_TOKEN="+trace.IngestToken() {
		t.Errorf("trace token = %q", env[3])
	}
	if strings.Contains(env[3], "real-api-secret") {
		t.Error("traceEnv leaked TERRA_TOKEN to the previewed app")
	}
}
