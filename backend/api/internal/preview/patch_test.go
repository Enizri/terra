package preview

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApplyToCheckoutWritesFile(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "web", "src")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "App.tsx"), []byte("export const n = 1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	diff := `--- a/web/src/App.tsx
+++ b/web/src/App.tsx
@@ -1,1 +1,1 @@
-export const n = 1
+export const n = 2
`
	if err := applyToCheckout(root, "web/src/App.tsx", diff); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(root, "web", "src", "App.tsx"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "export const n = 2\n" {
		t.Fatalf("got %q", got)
	}
}

func TestApplyToCheckoutCreatesNewFile(t *testing.T) {
	root := t.TempDir()
	diff := `@@ -0,0 +1,2 @@
+hello
+world
`
	if err := applyToCheckout(root, "notes/hello.txt", diff); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(root, "notes", "hello.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "hello\nworld\n" {
		t.Fatalf("got %q", got)
	}
}

func TestApplyToCheckoutStaysInsideCheckout(t *testing.T) {
	root := t.TempDir()
	realBase, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	diff := "@@ -0,0 +1,1 @@\n+secret\n"
	for _, p := range []string{"../etc/passwd", "../../outside", "src/../../../outside.txt", "ok.txt"} {
		_ = applyToCheckout(root, p, diff)
	}
	filepath.WalkDir(realBase, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil || d.IsDir() {
			return walkErr
		}
		if !strings.HasPrefix(path, realBase+string(filepath.Separator)) && path != realBase {
			t.Errorf("wrote outside checkout: %s", path)
		}
		return nil
	})
}

func TestApplyToCheckoutRejectsSymlinkTarget(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret")
	if err := os.WriteFile(secret, []byte("outside\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(secret, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	diff := "@@ -1,1 +1,1 @@\n-outside\n+pwned\n"
	if err := applyToCheckout(root, "escape", diff); err == nil {
		t.Fatal("must refuse writing through a symlink")
	}
	got, err := os.ReadFile(secret)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "outside\n" {
		t.Fatalf("symlink target mutated: %q", got)
	}
}

func TestApplyToCheckoutRejectsParentSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "out")); err != nil {
		t.Fatal(err)
	}
	diff := "@@ -0,0 +1,1 @@\n+pwned\n"
	if err := applyToCheckout(root, "out/secret.txt", diff); err == nil {
		t.Fatal("must refuse write via parent symlink out of checkout")
	}
	if _, err := os.Stat(filepath.Join(outside, "secret.txt")); err == nil {
		t.Fatal("wrote through parent symlink")
	}
}

func TestApplyToCheckoutSizeCap(t *testing.T) {
	root := t.TempDir()
	huge := strings.Repeat("x", maxPatchBytes+1)
	diff := "@@ -0,0 +1,1 @@\n+" + huge + "\n"
	if err := applyToCheckout(root, "big.txt", diff); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("err = %v, want too large", err)
	}
}

func TestApplyToCheckoutMismatch(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	diff := "@@ -1,1 +1,1 @@\n-goodbye\n+ok\n"
	if err := applyToCheckout(root, "a.txt", diff); err == nil || !strings.Contains(err.Error(), "does not apply") {
		t.Fatalf("err = %v, want does not apply", err)
	}
}

func TestSafeJoinUnchangedForFiles(t *testing.T) {
	base := t.TempDir()
	realBase, err := filepath.EvalSymlinks(base)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{
		"", "/", "src", "src/main.tsx", "src/../src/main.tsx",
		"../etc/passwd", "../../etc/passwd", "src/../../../outside", "/../etc/passwd",
	} {
		full, clean, err := SafeJoin(base, p)
		if err != nil {
			continue
		}
		if strings.Contains(clean, "..") {
			t.Errorf("SafeJoin(%q) kept a traversal segment: %q", p, clean)
		}
		if full != realBase && !strings.HasPrefix(full, realBase+string(filepath.Separator)) {
			t.Errorf("SafeJoin(%q) = %q — escapes %q", p, full, realBase)
		}
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(base, "escape")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := SafeJoin(base, "escape"); err == nil {
		t.Error("SafeJoin followed a symlink out of the checkout")
	}
}
