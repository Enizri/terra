package preview

import (
	"strings"
	"testing"
	"time"

	"github.com/Enizri/terra/internal/config"
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

func TestDockerRunnerMissingBinary(t *testing.T) {
	t.Setenv("TERRA_PREVIEW_MODE", "docker")
	t.Setenv("TERRA_PREVIEW_MAX", "2")
	t.Setenv("TERRA_DOCKER", "/nonexistent-terra-docker")
	t.Setenv("TERRA_PREVIEW_TTL", "1h")
	c := config.FromEnv()

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
