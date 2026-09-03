package preview

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseCLIArgsRejectsShell(t *testing.T) {
	if _, err := ParseCLIArgs("rm -rf /"); err != nil {
		t.Fatal(err)
	}
	for _, line := range []string{
		"foo; rm -rf /",
		"foo && rm",
		"foo | cat",
		"foo `id`",
		"foo > /tmp/x",
	} {
		if _, err := ParseCLIArgs(line); err == nil {
			t.Fatalf("accepted %q", line)
		}
	}
}

func TestCLICommandNodeBin(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"bin":{"map":"./bin/map.js"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	argv, ok := CLICommand(dir)
	if !ok || argv[0] != "node" || !strings.HasSuffix(argv[1], "map.js") {
		t.Fatalf("got %v", argv)
	}
}

func TestCLICommandGoCmd(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "cmd", "map"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "cmd", "map", "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	argv, ok := CLICommand(dir)
	if !ok || argv[2] != "./cmd/map" {
		t.Fatalf("got %v", argv)
	}
}

func TestCLICommandNone(t *testing.T) {
	if _, ok := CLICommand(t.TempDir()); ok {
		t.Fatal("empty tree is not a CLI")
	}
}
