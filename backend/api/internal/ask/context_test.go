package ask

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Enizri/terra/backend/api/internal/analyzerclient"
	"github.com/Enizri/terra/backend/api/internal/scan"
)

type stubPreview struct{}

func (stubPreview) Start(string) (string, error)            { return "", nil }
func (stubPreview) Lookup(string) (string, string, bool)    { return "", "", false }
func (stubPreview) ApplyPatch(string, string, string) error { return nil }
func (stubPreview) Restart(string) error                    { return nil }
func (stubPreview) StopAll()                                {}

func TestBuildPayloadUsesExistingCheckout(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CACHE_HOME", filepath.Join(home, "cache"))

	const repo = "github.com/usememos/memos"
	dir, err := scan.CheckoutDir("", repo)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	payload := BuildPayload(Input{
		RepoURL: repo, Question: "where?", Selection: map[string]any{"file": "main.go"},
		Model: analyzerclient.LLMOpts{Model: "test", BaseURL: "http://model"}, Preview: stubPreview{},
	})
	if got, _ := payload["file_snippet"].(string); !strings.Contains(got, "package main") {
		t.Fatalf("snippet = %q", got)
	}
	if payload["model"] != "test" || payload["base_url"] != "http://model" {
		t.Fatalf("model routing missing: %#v", payload)
	}
	if got := snippet(stubPreview{}, "", repo, "../outside.go", 0); got != "" {
		t.Fatalf("traversal snippet = %q, want empty", got)
	}
}
