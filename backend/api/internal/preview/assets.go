// Package preview boots a repo's frontend (and optional backend) behind a local proxy.
package preview

import (
	_ "embed"
	"os"
	"path/filepath"
	"strings"

	"github.com/Enizri/terra/backend/api/internal/config"
	"github.com/Enizri/terra/backend/api/internal/trace"
)

//go:embed select.js
var selectJS []byte

//go:embed hook.js
var hookJS []byte

// loadSelectJS prefers on-disk select.js; falls back to the embed.
func loadSelectJS() []byte {
	candidates := []string{
		"backend/api/internal/preview/select.js",
		"internal/preview/select.js",
		filepath.Join("..", "internal", "preview", "select.js"),
	}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates,
			filepath.Join(filepath.Dir(exe), "internal", "preview", "select.js"),
			filepath.Join(filepath.Dir(exe), "..", "internal", "preview", "select.js"),
		)
	}
	for _, cand := range candidates {
		b, err := os.ReadFile(cand)
		if err == nil && len(b) > 0 {
			return b
		}
	}
	return selectJS
}

// hookJSPath returns an absolute path to hook.js for NODE_OPTIONS --require.
func hookJSPath() (string, error) {
	candidates := []string{
		"hook.js", // go test cwd is this package
		"backend/api/internal/preview/hook.js",
		"internal/preview/hook.js",
		filepath.Join("..", "internal", "preview", "hook.js"),
	}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates,
			filepath.Join(filepath.Dir(exe), "internal", "preview", "hook.js"),
			filepath.Join(filepath.Dir(exe), "..", "internal", "preview", "hook.js"),
		)
	}
	for _, cand := range candidates {
		if b, err := os.ReadFile(cand); err == nil && len(b) > 0 {
			return filepath.Abs(cand)
		}
	}
	// Per-user cache dir, not the shared os.TempDir(): a fixed name in a
	// world-writable directory lets another local user plant a file that gets
	// --require'd into every previewed Node process.
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(cache, "terra")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	hookPath := filepath.Join(dir, "terra-hook.js")
	if err := os.WriteFile(hookPath, hookJS, 0o644); err != nil {
		return "", err
	}
	return hookPath, nil
}

// mergeNodeOptions appends the hook --require to NODE_OPTIONS.
func mergeNodeOptions(existing, hookPath string) string {
	if strings.Contains(hookPath, " ") {
		hookPath = `"` + hookPath + `"`
	}
	opt := "--require " + hookPath
	if existing == "" {
		return opt
	}
	return existing + " " + opt
}

// traceEnv returns env vars that preload hook.js for in-process spans.
// Spans post back to the Terra API port (c.Port()).
func traceEnv(c *config.Config, repoKey string) []string {
	hook, err := hookJSPath()
	if err != nil {
		return nil
	}
	env := []string{
		"NODE_OPTIONS=" + mergeNodeOptions(os.Getenv("NODE_OPTIONS"), hook),
		"TERRA_TRACE_URL=http://localhost:" + c.Port() + "/traces/ingest",
		"TERRA_TRACE_REPO=" + repoKey,
		"TERRA_TRACE_TOKEN=" + trace.IngestToken(),
	}
	return env
}

// childEnv is the environment for processes running untrusted repo code:
// just enough for npm/go toolchains, never the full host environment (which
// carries TERRA_TOKEN, cloud credentials, etc.).
func childEnv() []string {
	var env []string
	for _, key := range []string{
		"PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM", "USER", "LOGNAME", "SHELL",
		"GOPATH", "GOCACHE", "GOMODCACHE", "GOTOOLCHAIN", "GOPROXY",
	} {
		if v, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+v)
		}
	}
	return env
}

// dockerTraceVars are hook ingest settings for a sibling container
// (NODE_OPTIONS is set separately to the in-container hook path).
func dockerTraceVars(c *config.Config, repoKey string) []string {
	host := c.TraceHost
	if host == "" {
		host = "host.docker.internal"
	}
	return []string{
		"TERRA_TRACE_URL=http://" + host + ":" + c.Port() + "/traces/ingest",
		"TERRA_TRACE_REPO=" + repoKey,
		"TERRA_TRACE_TOKEN=" + trace.IngestToken(),
	}
}
