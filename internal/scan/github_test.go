package scan

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testSHA = "abc1234def5678abc1234def5678abc1234def56"

// fakeGitHub stands in for api.github.com and codeload.github.com, serving
// one repo at one SHA. Restores the real endpoints on test cleanup.
func fakeGitHub(t *testing.T, tgz []byte) {
	t.Helper()
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/o/r/commits/HEAD" {
			http.NotFound(w, r)
			return
		}
		w.Write([]byte(testSHA))
	}))
	codeload := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/o/r/tar.gz/"+testSHA {
			http.NotFound(w, r)
			return
		}
		w.Write(tgz)
	}))
	oldAPI, oldCodeload := apiBase, codeloadBase
	apiBase, codeloadBase = api.URL, codeload.URL
	t.Cleanup(func() {
		apiBase, codeloadBase = oldAPI, oldCodeload
		api.Close()
		codeload.Close()
	})
}

func TestScanStreamsTarballWithoutGit(t *testing.T) {
	fakeGitHub(t, makeTarball(t, "r-"+testSHA[:7], map[string]string{
		"main.go":         "package main\n",
		"web/src/App.tsx": "export {}\n",
	}))
	res, err := Scan("github.com/o/r")
	if err != nil {
		t.Fatal(err)
	}
	if res.Commit != testSHA {
		t.Errorf("commit = %q, want the resolved SHA", res.Commit)
	}
	if res.RepositoryURL != "https://github.com/o/r" || res.Name != "r" {
		t.Errorf("url/name = %q/%q", res.RepositoryURL, res.Name)
	}
	if got := strings.Join(res.Files, ","); got != "main.go,web/src/App.tsx" {
		t.Errorf("files = %q", got)
	}
}

func TestCheckoutDirUsesOverride(t *testing.T) {
	base := t.TempDir()
	t.Setenv("TERRA_CHECKOUT_DIR", base)
	dir, err := CheckoutDir("https://github.com/acme/notes")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(base, "acme-notes")
	if dir != want {
		t.Fatalf("CheckoutDir = %q, want %q", dir, want)
	}
}

func TestResolveCommitReportsAPIFailure(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "rate limit exceeded", http.StatusForbidden)
	}))
	old := apiBase
	apiBase = api.URL
	t.Cleanup(func() { apiBase = old; api.Close() })

	_, err := ResolveCommit("o", "r")
	if err == nil || !strings.Contains(err.Error(), "403") {
		t.Errorf("err = %v, want the API status surfaced", err)
	}
}

func TestCheckoutExtractsTarballSafely(t *testing.T) {
	// A hostile tarball: a normal file, a traversal attempt, and a symlink
	// pointing outside the tree. Only the normal file may materialize.
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for _, h := range []tar.Header{
		{Name: "r-abc/", Typeflag: tar.TypeDir, Mode: 0o755},
		{Name: "r-abc/main.go", Typeflag: tar.TypeReg, Mode: 0o644, Size: 2},
		{Name: "r-abc/../escape.txt", Typeflag: tar.TypeReg, Mode: 0o644, Size: 2},
		{Name: "r-abc/evil-link", Typeflag: tar.TypeSymlink, Linkname: "/etc/passwd"},
	} {
		if err := tw.WriteHeader(&h); err != nil {
			t.Fatal(err)
		}
		if h.Typeflag == tar.TypeReg {
			tw.Write([]byte("ok"))
		}
	}
	tw.Close()
	gz.Close()
	fakeGitHub(t, buf.Bytes())

	home := t.TempDir()
	t.Setenv("HOME", home) // os.UserCacheDir derives from HOME on darwin/linux

	dir, err := Checkout("github.com/o/r")
	if err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filepath.Join(dir, "main.go")); err != nil || string(data) != "ok" {
		t.Errorf("main.go = %q, %v", data, err)
	}
	if _, err := os.Lstat(filepath.Join(dir, "evil-link")); err == nil {
		t.Error("symlink from the tarball must not be extracted")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(dir), "escape.txt")); err == nil {
		t.Error("traversal entry escaped the checkout dir")
	}
	if sha, err := os.ReadFile(filepath.Join(dir, checkoutMarker)); err != nil || string(sha) != testSHA {
		t.Errorf("commit marker = %q, %v; want the resolved SHA", sha, err)
	}
	// No .git anywhere — Phase 0's done-condition.
	if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
		t.Error("a tarball checkout must not contain .git")
	}

	// Second call reuses without hitting the network: point at dead servers.
	apiBase, codeloadBase = "http://127.0.0.1:1", "http://127.0.0.1:1"
	dir2, err := Checkout("github.com/o/r")
	if err != nil || dir2 != dir {
		t.Errorf("reuse: dir=%q err=%v, want cached %q", dir2, err, dir)
	}
}
