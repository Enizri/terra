package scan

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
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
	dir, err := CheckoutDir(base, "https://github.com/acme/notes")
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
		http.Error(w, "not found", http.StatusNotFound)
	}))
	old := apiBase
	apiBase = api.URL
	t.Cleanup(func() { apiBase = old; api.Close() })

	_, err := ResolveCommit("o", "r")
	if err == nil || !strings.Contains(err.Error(), "404") {
		t.Errorf("err = %v, want the API status surfaced", err)
	}
}

func TestResolveCommitRateLimitError(t *testing.T) {
	t.Setenv("GITHUB_TOKEN", "")
	reset := time.Now().Add(time.Hour).Unix()
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(reset, 10))
		http.Error(w, "API rate limit exceeded", http.StatusForbidden)
	}))
	old := apiBase
	apiBase = api.URL
	t.Cleanup(func() { apiBase = old; api.Close() })

	_, err := ResolveCommit("o", "r")
	if !IsRateLimited(err) {
		t.Fatalf("err = %v, want RateLimitError", err)
	}
	msg := err.Error()
	if !strings.Contains(msg, "GitHub rate limit hit") || !strings.Contains(msg, "GITHUB_TOKEN") {
		t.Errorf("err = %q, want friendly rate-limit message", msg)
	}
	var rl *RateLimitError
	if !errors.As(err, &rl) || rl.Reset.Unix() != reset {
		t.Errorf("Reset = %v, want unix %d", rl, reset)
	}
}

func TestGitHubAuthHeaderOnResolveAndTarball(t *testing.T) {
	t.Setenv("GITHUB_TOKEN", "test-token")
	var apiAuth, codeAuth string
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiAuth = r.Header.Get("Authorization")
		w.Write([]byte(testSHA))
	}))
	codeload := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		codeAuth = r.Header.Get("Authorization")
		w.Write(makeTarball(t, "r-"+testSHA[:7], map[string]string{"main.go": "package main\n"}))
	}))
	oldAPI, oldCodeload := apiBase, codeloadBase
	apiBase, codeloadBase = api.URL, codeload.URL
	t.Cleanup(func() {
		apiBase, codeloadBase = oldAPI, oldCodeload
		api.Close()
		codeload.Close()
	})

	if _, err := Scan("github.com/o/r"); err != nil {
		t.Fatal(err)
	}
	want := "Bearer test-token"
	if apiAuth != want || codeAuth != want {
		t.Errorf("auth resolve=%q tarball=%q, want both %q", apiAuth, codeAuth, want)
	}
}

func TestScanAtSkipsResolve(t *testing.T) {
	apiHits := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiHits++
		http.Error(w, "should not call commits API", http.StatusInternalServerError)
	}))
	codeload := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/o/r/tar.gz/"+testSHA {
			http.NotFound(w, r)
			return
		}
		w.Write(makeTarball(t, "r-"+testSHA[:7], map[string]string{"main.go": "package main\n"}))
	}))
	oldAPI, oldCodeload := apiBase, codeloadBase
	apiBase, codeloadBase = api.URL, codeload.URL
	t.Cleanup(func() {
		apiBase, codeloadBase = oldAPI, oldCodeload
		api.Close()
		codeload.Close()
	})

	res, err := ScanAt("github.com/o/r", testSHA)
	if err != nil {
		t.Fatal(err)
	}
	if apiHits != 0 {
		t.Errorf("commits API hit %d times; ScanAt must skip resolve", apiHits)
	}
	if res.Commit != testSHA {
		t.Errorf("commit = %q, want %q", res.Commit, testSHA)
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

	dir, err := Checkout("", "github.com/o/r")
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

	// Same HEAD reuses the tree: tarball is not fetched again.
	codeloadHits := 0
	codeload := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		codeloadHits++
		http.Error(w, "tarball must not be re-fetched", http.StatusInternalServerError)
	}))
	oldCodeload := codeloadBase
	codeloadBase = codeload.URL
	t.Cleanup(func() { codeloadBase = oldCodeload; codeload.Close() })
	dir2, err := Checkout("", "github.com/o/r")
	if err != nil || dir2 != dir || codeloadHits != 0 {
		t.Errorf("reuse: dir=%q err=%v hits=%d, want cached %q", dir2, err, codeloadHits, dir)
	}
}

func TestRepoMeta(t *testing.T) {
	var gotPath, gotAuth string
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotAuth = r.URL.Path, r.Header.Get("Authorization")
		w.Write([]byte(`{"language":"Go","size":4096,"stargazers_count":7}`))
	}))
	old := apiBase
	apiBase = api.URL
	t.Cleanup(func() { apiBase = old; api.Close() })
	t.Setenv("GITHUB_TOKEN", "test-token")

	language, sizeKB, err := RepoMeta("github.com/acme/notes")
	if err != nil {
		t.Fatal(err)
	}
	if language != "Go" || sizeKB != 4096 {
		t.Errorf("RepoMeta = %q, %d", language, sizeKB)
	}
	if gotPath != "/repos/acme/notes" {
		t.Errorf("path = %q", gotPath)
	}
	if gotAuth != "Bearer test-token" {
		t.Errorf("RepoMeta must reuse the GitHub token, got %q", gotAuth)
	}
}

func TestRepoMetaRateLimitError(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "API rate limit exceeded", http.StatusForbidden)
	}))
	old := apiBase
	apiBase = api.URL
	t.Cleanup(func() { apiBase = old; api.Close() })

	if _, _, err := RepoMeta("github.com/acme/notes"); !IsRateLimited(err) {
		t.Errorf("err = %v, want RateLimitError", err)
	}
}

func TestCheckoutRefreshesWhenCommitChanges(t *testing.T) {
	current := testSHA
	tgzFor := func(sha string) []byte {
		return makeTarball(t, "r-"+sha[:7], map[string]string{"main.go": "package main\n// " + sha + "\n"})
	}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(current))
	}))
	downloads := 0
	codeload := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/o/r/tar.gz/"+current {
			http.NotFound(w, r)
			return
		}
		downloads++
		w.Write(tgzFor(current))
	}))
	oldAPI, oldCodeload := apiBase, codeloadBase
	apiBase, codeloadBase = api.URL, codeload.URL
	t.Cleanup(func() {
		apiBase, codeloadBase = oldAPI, oldCodeload
		api.Close()
		codeload.Close()
	})

	home := t.TempDir()
	t.Setenv("HOME", home)

	dir, err := Checkout("", "github.com/o/r")
	if err != nil {
		t.Fatal(err)
	}
	if downloads != 1 {
		t.Fatalf("first checkout downloads = %d, want 1", downloads)
	}

	current = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	dir2, err := Checkout("", "github.com/o/r")
	if err != nil {
		t.Fatal(err)
	}
	if dir2 != dir {
		t.Errorf("dir = %q, want same path %q", dir2, dir)
	}
	if downloads != 2 {
		t.Errorf("after HEAD moved, downloads = %d, want 2", downloads)
	}
	if got := CheckoutCommit(dir2); got != current {
		t.Errorf("marker = %q, want %q", got, current)
	}
	data, err := os.ReadFile(filepath.Join(dir2, "main.go"))
	if err != nil || !strings.Contains(string(data), current) {
		t.Errorf("main.go = %q, %v; want the new commit", data, err)
	}
}

func TestExtractTarballRejectsOversize(t *testing.T) {
	oldBytes, oldFiles := maxExtractBytes, maxExtractFiles
	maxExtractBytes, maxExtractFiles = 8, 100
	t.Cleanup(func() { maxExtractBytes, maxExtractFiles = oldBytes, oldFiles })

	tgz := makeTarball(t, "r-abc", map[string]string{"big.txt": "0123456789abcdef"})
	err := extractTarball(bytes.NewReader(tgz), t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("err = %v, want oversize rejection", err)
	}
}

func TestExtractTarballRejectsTooManyFiles(t *testing.T) {
	oldBytes, oldFiles := maxExtractBytes, maxExtractFiles
	maxExtractBytes, maxExtractFiles = 1<<20, 2
	t.Cleanup(func() { maxExtractBytes, maxExtractFiles = oldBytes, oldFiles })

	tgz := makeTarball(t, "r-abc", map[string]string{
		"a.go": "package a\n",
		"b.go": "package b\n",
		"c.go": "package c\n",
	})
	err := extractTarball(bytes.NewReader(tgz), t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "too many files") {
		t.Fatalf("err = %v, want file-count rejection", err)
	}
}

func TestFetchTarballAllowsSlowBody(t *testing.T) {
	tgz := makeTarball(t, "r-"+testSHA[:7], map[string]string{"main.go": "package main\n"})
	codeload := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		time.Sleep(200 * time.Millisecond)
		w.Write(tgz)
	}))
	oldClient, oldCodeload := httpClient, codeloadBase
	httpClient = newGitHubClient()
	codeloadBase = codeload.URL
	t.Cleanup(func() {
		httpClient, codeloadBase = oldClient, oldCodeload
		codeload.Close()
	})

	body, err := fetchTarball("o", "r", testSHA)
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	got, err := io.ReadAll(body)
	if err != nil || len(got) == 0 {
		t.Fatalf("body = %d bytes, err=%v", len(got), err)
	}
}

func TestGitHubClientTimesOutSlowHeaders(t *testing.T) {
	oldHeader, oldClient := responseHeaderTimeout, httpClient
	responseHeaderTimeout = 50 * time.Millisecond
	httpClient = newGitHubClient()
	t.Cleanup(func() {
		responseHeaderTimeout = oldHeader
		httpClient = oldClient
	})

	codeload := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(300 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	oldCodeload := codeloadBase
	codeloadBase = codeload.URL
	t.Cleanup(func() { codeloadBase = oldCodeload; codeload.Close() })

	_, err := fetchTarball("o", "r", testSHA)
	if err == nil {
		t.Fatal("want a response-header timeout, got nil")
	}
}
