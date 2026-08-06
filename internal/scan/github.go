package scan

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var githubRe = regexp.MustCompile(`^(?:https://github\.com/|git@github\.com:|github\.com/)([\w.-]+)/([\w.-]+?)(?:\.git)?(?:/.*)?$`)

// Overridable in tests; production values are GitHub's.
var (
	apiBase      = "https://api.github.com"
	codeloadBase = "https://codeload.github.com"
)

// Tarball downloads can be large; commit resolution is a tiny JSON call.
var httpClient = &http.Client{Timeout: 2 * time.Minute}

// NormalizeURL turns any common GitHub repo reference into a canonical
// https URL and returns it with the repo name.
func NormalizeURL(raw string) (url, name string, err error) {
	owner, repo, err := ownerRepo(raw)
	if err != nil {
		return "", "", err
	}
	return "https://github.com/" + owner + "/" + repo, repo, nil
}

func ownerRepo(raw string) (owner, repo string, err error) {
	m := githubRe.FindStringSubmatch(strings.TrimSpace(raw))
	if m == nil {
		return "", "", fmt.Errorf("not a GitHub repository URL: %q (expected https://github.com/owner/repo)", raw)
	}
	return m[1], m[2], nil
}

// ResolveCommit asks the GitHub API for the SHA of the default branch's HEAD.
// Everything downstream — scans, stored maps, checkouts — keys off this SHA.
func ResolveCommit(owner, repo string) (string, error) {
	req, err := http.NewRequest("GET", apiBase+"/repos/"+owner+"/"+repo+"/commits/HEAD", nil)
	if err != nil {
		return "", err
	}
	// The .sha media type returns the bare SHA instead of a commit object.
	req.Header.Set("Accept", "application/vnd.github.sha")
	if tok := os.Getenv("GITHUB_TOKEN"); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("resolve %s/%s: GitHub API returned %s: %s",
			owner, repo, resp.Status, strings.TrimSpace(string(body)))
	}
	sha := strings.TrimSpace(string(body))
	if sha == "" {
		return "", fmt.Errorf("resolve %s/%s: empty SHA from GitHub API", owner, repo)
	}
	return sha, nil
}

// fetchTarball streams the repo tarball for one commit from codeload. No git,
// no .git directory, no working tree unless the caller extracts one.
func fetchTarball(owner, repo, sha string) (io.ReadCloser, error) {
	resp, err := httpClient.Get(codeloadBase + "/" + owner + "/" + repo + "/tar.gz/" + sha)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("download %s/%s@%s: codeload returned %s", owner, repo, sha[:min(7, len(sha))], resp.Status)
	}
	return resp.Body, nil
}

// stripRoot removes the "repo-sha/" prefix codeload puts on every entry.
// Entries without it (pax_global_header) report ok=false.
func stripRoot(name string) (rel string, ok bool) {
	_, rest, found := strings.Cut(name, "/")
	return strings.TrimSuffix(rest, "/"), found
}

// CheckoutDir is where Checkout keeps rawURL's working copy. It only computes
// the path — callers that must not download (a request handler) can Stat it.
func CheckoutDir(rawURL string) (string, error) {
	owner, repo, err := ownerRepo(rawURL)
	if err != nil {
		return "", err
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cache, "terra", "checkouts", owner+"-"+repo), nil
}

// checkoutMarker records which commit a checkout was extracted from.
const checkoutMarker = ".terra-commit"

// Checkout extracts (or reuses) a persistent working copy for previews from
// the commit tarball. No git involved and no .git directory on disk.
func Checkout(rawURL string) (string, error) {
	owner, repo, err := ownerRepo(rawURL)
	if err != nil {
		return "", err
	}
	dir, err := CheckoutDir(rawURL)
	if err != nil {
		return "", err
	}
	// ponytail: no refresh; a stale checkout is fine for an MVP preview.
	// (.git is the marker of a checkout made before the tarball era.)
	for _, marker := range []string{checkoutMarker, ".git"} {
		if _, err := os.Stat(filepath.Join(dir, marker)); err == nil {
			return dir, nil
		}
	}
	sha, err := ResolveCommit(owner, repo)
	if err != nil {
		return "", err
	}
	body, err := fetchTarball(owner, repo, sha)
	if err != nil {
		return "", err
	}
	defer body.Close()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	if err := extractTarball(body, dir); err != nil {
		os.RemoveAll(dir)
		return "", err
	}
	if err := os.WriteFile(filepath.Join(dir, checkoutMarker), []byte(sha), 0o644); err != nil {
		os.RemoveAll(dir)
		return "", err
	}
	return dir, nil
}

// CheckoutCommit returns the SHA a tarball checkout was extracted from, or
// "" for a pre-tarball (git) checkout.
func CheckoutCommit(dir string) string {
	data, err := os.ReadFile(filepath.Join(dir, checkoutMarker))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// extractTarball writes a codeload tarball's files under dir. Entries that
// would escape dir are dropped, and symlinks are skipped entirely — a repo's
// link can point anywhere and this tree is served back over /files.
func extractTarball(r io.Reader, dir string) error {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return fmt.Errorf("read tarball: %w", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("read tarball: %w", err)
		}
		rel, ok := stripRoot(hdr.Name)
		if !ok || rel == "" {
			continue
		}
		clean := path.Clean(rel)
		if clean == ".." || strings.HasPrefix(clean, "../") || path.IsAbs(clean) {
			continue
		}
		target := filepath.Join(dir, filepath.FromSlash(clean))
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			perm := hdr.FileInfo().Mode().Perm()
			if perm == 0 {
				perm = 0o644
			}
			f, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, perm)
			if err != nil {
				return err
			}
			_, err = io.Copy(f, tr)
			if cerr := f.Close(); err == nil {
				err = cerr
			}
			if err != nil {
				return err
			}
		}
	}
}
