package preview

import (
	"os"
	"path/filepath"
	"testing"
)

func TestTestCommandPrefersPackageScript(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"scripts":{"test":"jest"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	argv, ok := TestCommand(dir)
	if !ok || len(argv) != 2 || argv[0] != "npm" || argv[1] != "test" {
		t.Fatalf("got %v, want npm test", argv)
	}
}

func TestTestCommandYarnLock(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"scripts":{"test":"jest"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "yarn.lock"), []byte("#"), 0o644); err != nil {
		t.Fatal(err)
	}
	argv, ok := TestCommand(dir)
	if !ok || argv[0] != "yarn" {
		t.Fatalf("got %v, want yarn test", argv)
	}
}

func TestTestCommandGo(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	argv, ok := TestCommand(dir)
	if !ok || argv[0] != "go" {
		t.Fatalf("got %v, want go test", argv)
	}
}

func TestTestCommandNone(t *testing.T) {
	if _, ok := TestCommand(t.TempDir()); ok {
		t.Fatal("empty tree has no tests")
	}
}
