package preview

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Enizri/terra/internal/config"
	"github.com/Enizri/terra/internal/trace"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestDetectPrefersFrontendPackage(t *testing.T) {
	root := t.TempDir()
	// A root package with only `start`, and a nested web package with `dev`
	// plus react/vite deps — the nested one must win.
	writeFile(t, filepath.Join(root, "package.json"),
		`{"scripts":{"start":"node server.js"}}`)
	writeFile(t, filepath.Join(root, "web", "package.json"),
		`{"scripts":{"dev":"vite"},"devDependencies":{"vite":"^5","react":"^19"}}`)

	appDir, script, pm, err := detect(root)
	if err != nil {
		t.Fatal(err)
	}
	if appDir != filepath.Join(root, "web") || script != "dev" || pm != "npm" {
		t.Fatalf("got appDir=%q script=%q pm=%q", appDir, script, pm)
	}
}

func TestDetectSkipsDeepAndBrokenPackages(t *testing.T) {
	root := t.TempDir()
	// Too deep (depth > 2) and unparsable ones are ignored.
	writeFile(t, filepath.Join(root, "a", "b", "c", "package.json"),
		`{"scripts":{"dev":"vite"}}`)
	writeFile(t, filepath.Join(root, "broken", "package.json"), `{not json`)
	if _, _, _, err := detect(root); err == nil {
		t.Fatal("want error when no runnable package.json is in range")
	}
}

func TestPackageManagerFromLockfile(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "web")
	writeFile(t, filepath.Join(root, "pnpm-lock.yaml"), "")
	if pm := packageManager(dir, root); pm != "pnpm" {
		t.Fatalf("got %q, want pnpm from root lockfile", pm)
	}
	writeFile(t, filepath.Join(dir, "yarn.lock"), "")
	if pm := packageManager(dir, root); pm != "yarn" {
		t.Fatalf("got %q, want yarn from app-dir lockfile", pm)
	}
}

func TestDetectGoBackend(t *testing.T) {
	root := t.TempDir()
	if _, ok := detectGoBackend(root); ok {
		t.Fatal("no go.mod: want no backend")
	}
	writeFile(t, filepath.Join(root, "go.mod"), "module x\n")
	writeFile(t, filepath.Join(root, "cmd", "app", "main.go"), "package main\n")
	pkg, ok := detectGoBackend(root)
	if !ok || pkg != "./cmd/app" {
		t.Fatalf("got %q, %v", pkg, ok)
	}
	// Two commands: ambiguous, so no backend rather than a guessed one.
	writeFile(t, filepath.Join(root, "cmd", "other", "main.go"), "package main\n")
	if _, ok := detectGoBackend(root); ok {
		t.Fatal("two cmds: want no backend")
	}
}

func TestCandidatePorts(t *testing.T) {
	logs := &boundedBuf{}
	logs.Write([]byte("backend on localhost:8081\nready at http://localhost:5173/\nalso 127.0.0.1:5173 and localhost:3000"))
	got := candidatePorts(4000, logs, []int{8081})
	want := []int{4000, 5173, 3000}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestBoundedBufKeepsTail(t *testing.T) {
	b := &boundedBuf{}
	b.Write([]byte("start-marker"))
	chunk := strings.Repeat("x", 32<<10)
	b.Write([]byte(chunk))
	b.Write([]byte(chunk))
	b.Write([]byte("end-marker"))
	s := b.String()
	if len(s) > 64<<10 {
		t.Fatalf("buffer grew to %d, cap is 64KB", len(s))
	}
	if strings.Contains(s, "start-marker") || !strings.HasSuffix(s, "end-marker") {
		t.Fatal("want oldest output dropped and newest kept")
	}
}

func TestRefreshCookieAcceptsEitherHeader(t *testing.T) {
	resp := &http.Response{Header: http.Header{}}
	if refreshCookie(resp) != "" {
		t.Fatal("no headers: want empty")
	}
	resp.Header.Set("Grpc-Metadata-Set-Cookie", "memos_refresh=abc; Path=/; HttpOnly")
	if got := refreshCookie(resp); got != "memos_refresh=abc" {
		t.Fatalf("got %q", got)
	}
	resp.Header = http.Header{}
	resp.Header.Add("Set-Cookie", "other=1")
	resp.Header.Add("Set-Cookie", "memos_refresh=def")
	if got := refreshCookie(resp); got != "memos_refresh=def" {
		t.Fatalf("got %q", got)
	}
}

func TestTailTruncates(t *testing.T) {
	if got := tail([]byte("  short  ")); got != "short" {
		t.Fatalf("got %q", got)
	}
	long := strings.Repeat("y", 5000)
	if got := tail([]byte(long)); len(got) != 2000 {
		t.Fatalf("got len %d, want 2000", len(got))
	}
}

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

func TestSeedDemoAuthUnknownRepoIsNil(t *testing.T) {
	if seedDemoAuth("https://github.com/acme/notes", "http://localhost:1") != nil {
		t.Fatal("expected nil hook for repo without a demo-auth entry")
	}
}
