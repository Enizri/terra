package preview

import (
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Enizri/terra/backend/api/internal/config"
)

func TestDefaultRunnerHostModes(t *testing.T) {
	for _, mode := range []string{"", "host", "HOST", " Host "} {
		t.Setenv("TERRA_PREVIEW_MODE", mode)
		c := config.FromEnv()
		if got := Default(c); got != Host(c) {
			t.Errorf("TERRA_PREVIEW_MODE=%q: Default() = %T, want host", mode, got)
		}
	}
}

func TestDefaultRunnerDockerConstructs(t *testing.T) {
	t.Setenv("TERRA_PREVIEW_MODE", "docker")
	c := config.FromEnv()
	r := Default(c)
	if r != Docker(c) {
		t.Fatalf("Default() = %T, want Docker()", r)
	}
	if _, _, ok := r.Lookup("https://github.com/acme/notes"); ok {
		t.Fatal("Lookup should miss when nothing is running")
	}

	t.Setenv("TERRA_PREVIEW_MAX", "0")
	r = Default(config.FromEnv())
	_, err := r.Start("https://github.com/acme/notes")
	if err == nil || !strings.Contains(err.Error(), "capacity full") {
		t.Fatalf("max=0 err = %v, want capacity full", err)
	}
}

// A second Start for a repo already booting must wait for that boot and reuse
// its instance, not race it (or block behind the runner mutex for minutes).
func TestStartWaitsForInFlightBoot(t *testing.T) {
	// A live "dev server" so alive(port) sees the finished instance.
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	t.Cleanup(ts.Close)
	port, _ := strconv.Atoi(strings.TrimPrefix(ts.URL, "http://127.0.0.1:"))

	key := "https://github.com/acme/notes"
	ch := make(chan struct{})
	r := &hostRunner{
		byRepo: map[string]*instance{},
		boots:  map[string]*bootWait{key: {done: ch}},
	}

	done := make(chan string, 1)
	go func() {
		url, err := r.Start(key)
		if err != nil {
			done <- "err: " + err.Error()
			return
		}
		done <- url
	}()

	select {
	case got := <-done:
		t.Fatalf("Start returned %q before the in-flight boot finished", got)
	case <-time.After(100 * time.Millisecond):
	}

	r.mu.Lock()
	r.byRepo[key] = &instance{
		proxyURL: "http://proxy/",
		apps:     []*appProcess{{port: port, primary: true}},
	}
	delete(r.boots, key)
	r.mu.Unlock()
	close(ch)

	select {
	case got := <-done:
		if got != "http://proxy/" {
			t.Fatalf("Start = %q, want the booted instance's proxy URL", got)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Start never returned after the boot finished")
	}
}

func TestHostStopAllKillsStarting(t *testing.T) {
	r := &hostRunner{
		byRepo:   map[string]*instance{},
		starting: map[string]*instance{},
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	key := "https://github.com/acme/notes"
	r.starting[key] = &instance{apps: []*appProcess{{proxyLn: ln}}}
	r.StopAll()
	if len(r.starting) != 0 {
		t.Fatalf("starting left %d entries after StopAll", len(r.starting))
	}
	// Closing twice must not panic — StopAll nils the listener.
	if err := ln.Close(); err == nil {
		t.Fatal("expected listener already closed by StopAll")
	}
}

func TestHostRestartStopsExistingBeforeStart(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "acme-notes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".terra-commit"), []byte("deadbeef"), 0o644); err != nil {
		t.Fatal(err)
	}
	r := &hostRunner{
		byRepo: map[string]*instance{},
		cfg:    &config.Config{CheckoutDir: base, PreviewMax: 2},
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	key := "https://github.com/acme/notes"
	r.byRepo[key] = &instance{proxyURL: "http://old/", apps: []*appProcess{{proxyLn: ln}}}
	if err := r.Restart(key); err == nil {
		t.Fatal("Start should fail without a frontend")
	}
	if err := ln.Close(); err == nil {
		t.Fatal("expected listener already closed by Restart")
	}
	if _, ok := r.byRepo[key]; ok {
		t.Fatal("failed Start must not leave a byRepo entry")
	}
}

func TestDockerStopAllKillsStarting(t *testing.T) {
	r := &dockerRunner{
		cfg:      &config.Config{DockerBin: "/nonexistent-terra-docker"},
		byRepo:   map[string]*instance{},
		starting: map[string]*instance{},
	}
	key := "https://github.com/acme/notes"
	r.starting[key] = &instance{apps: []*appProcess{{containerName: "terra-preview-test", liveID: "test"}}}
	r.StopAll()
	if len(r.starting) != 0 || len(r.byRepo) != 0 {
		t.Fatal("StopAll left starting/byRepo entries")
	}
}

func TestDockerRunnerMissingBinary(t *testing.T) {
	t.Setenv("TERRA_PREVIEW_MODE", "docker")
	t.Setenv("TERRA_PREVIEW_MAX", "2")
	t.Setenv("TERRA_DOCKER", "/nonexistent-terra-docker")
	t.Setenv("TERRA_PREVIEW_TTL", "1h")
	base := t.TempDir()
	t.Setenv("TERRA_CHECKOUT_DIR", base)
	c := config.FromEnv()

	dir := filepath.Join(base, "acme-notes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".terra-commit"), []byte("deadbeef"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"scripts":{"dev":"vite"},"devDependencies":{"vite":"^5"}}`), 0o644); err != nil {
		t.Fatal(err)
	}

	// Fresh runner state: StopAll clears any prior test residue.
	Docker(c).StopAll()
	_, err := Docker(c).Start("https://github.com/acme/notes")
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("err = %v, want docker binary not found", err)
	}
}

func TestDefaultRunnerUnknownMode(t *testing.T) {
	t.Setenv("TERRA_PREVIEW_MODE", "firecracker")
	_, err := Default(config.FromEnv()).Start("https://github.com/acme/notes")
	if err == nil || !strings.Contains(err.Error(), "unknown TERRA_PREVIEW_MODE") {
		t.Fatalf("err = %v", err)
	}
}

func TestPreviewTTLParsing(t *testing.T) {
	cases := []struct {
		raw  string
		want time.Duration
	}{
		{"", 30 * time.Minute},
		{"1h", time.Hour},
		{"0", 0},
		{"bogus", 30 * time.Minute},
		{"30m", 30 * time.Minute},
	}
	for _, c := range cases {
		t.Setenv("TERRA_PREVIEW_TTL", c.raw)
		if got := config.FromEnv().PreviewTTL; got != c.want {
			t.Errorf("PreviewTTL(%q) = %s, want %s", c.raw, got, c.want)
		}
	}
}

func TestHostCapacityCountsApps(t *testing.T) {
	r := &hostRunner{
		byRepo: map[string]*instance{
			"https://github.com/acme/a": {apps: []*appProcess{{}, {}}},
		},
		cfg: &config.Config{PreviewMax: 2, CheckoutDir: t.TempDir()},
	}
	_, err := r.Start("https://github.com/acme/b")
	if err == nil || !strings.Contains(err.Error(), "capacity full") {
		t.Fatalf("err = %v, want capacity full counting the two apps already running", err)
	}
}

func TestDockerCapacityCountsApps(t *testing.T) {
	r := &dockerRunner{
		cfg: &config.Config{PreviewMax: 2, DockerBin: "/nonexistent-terra-docker"},
		byRepo: map[string]*instance{
			"https://github.com/acme/a": {apps: []*appProcess{{}, {}}},
		},
	}
	_, err := r.Start("https://github.com/acme/b")
	if err == nil || !strings.Contains(err.Error(), "capacity full") {
		t.Fatalf("err = %v, want capacity full counting apps, not repos", err)
	}
}

func TestHostIdleTTLExpires(t *testing.T) {
	r := &hostRunner{
		byRepo: map[string]*instance{},
		cfg:    &config.Config{PreviewTTL: 40 * time.Millisecond, PreviewMax: 2},
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	key := "https://github.com/acme/notes"
	inst := &instance{apps: []*appProcess{{proxyLn: ln}}}
	r.byRepo[key] = inst
	r.resetTTLLocked(key, inst, r.cfg.PreviewTTL)

	deadline := time.After(time.Second)
	for {
		r.mu.Lock()
		_, ok := r.byRepo[key]
		r.mu.Unlock()
		if !ok {
			break
		}
		select {
		case <-deadline:
			t.Fatal("host TTL did not expire")
		case <-time.After(15 * time.Millisecond):
		}
	}
	if err := ln.Close(); err == nil {
		t.Fatal("expected listener closed by TTL")
	}
}
