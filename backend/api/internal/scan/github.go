package scan

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
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

// RateLimitError is returned when GitHub rejects a request for quota reasons.
type RateLimitError struct {
	Status string
	Body   string
	Reset  time.Time // zero if unknown
}

func (e *RateLimitError) Error() string {
	msg := "GitHub rate limit hit"
	if !e.Reset.IsZero() {
		msg += "; retry after " + e.Reset.UTC().Format(time.RFC3339)
	}
	if os.Getenv("GITHUB_TOKEN") == "" {
		msg += " — set GITHUB_TOKEN for higher limits"
	}
	return msg
}

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
	match := githubRe.FindStringSubmatch(strings.TrimSpace(raw))
	if match == nil {
		return "", "", fmt.Errorf("not a GitHub repository URL: %q (expected https://github.com/owner/repo)", raw)
	}
	return match[1], match[2], nil
}

func setGitHubAuth(req *http.Request) {
	if tok := os.Getenv("GITHUB_TOKEN"); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
}

func githubAPIError(op, owner, repo string, resp *http.Response, body []byte) error {
	text := strings.TrimSpace(string(body))
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
		return &RateLimitError{
			Status: resp.Status,
			Body:   text,
			Reset:  rateLimitReset(resp),
		}
	}
	return fmt.Errorf("%s %s/%s: GitHub API returned %s: %s",
		op, owner, repo, resp.Status, text)
}

func rateLimitReset(resp *http.Response) time.Time {
	if ra := resp.Header.Get("Retry-After"); ra != "" {
		if secs, err := strconv.Atoi(ra); err == nil {
			return time.Now().Add(time.Duration(secs) * time.Second)
		}
		if t, err := http.ParseTime(ra); err == nil {
			return t
		}
	}
	if raw := resp.Header.Get("X-RateLimit-Reset"); raw != "" {
		if unix, err := strconv.ParseInt(raw, 10, 64); err == nil {
			return time.Unix(unix, 0)
		}
	}
	return time.Time{}
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
	setGitHubAuth(req)
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		return "", githubAPIError("resolve", owner, repo, resp, body)
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
	req, err := http.NewRequest("GET", codeloadBase+"/"+owner+"/"+repo+"/tar.gz/"+sha, nil)
	if err != nil {
		return nil, err
	}
	setGitHubAuth(req)
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		short := sha
		if len(sha) > 7 {
			short = sha[:7]
		}
		if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
			return nil, &RateLimitError{
				Status: resp.Status,
				Body:   strings.TrimSpace(string(body)),
				Reset:  rateLimitReset(resp),
			}
		}
		return nil, fmt.Errorf("download %s/%s@%s: codeload returned %s", owner, repo, short, resp.Status)
	}
	return resp.Body, nil
}

// IsRateLimited reports whether err is (or wraps) a GitHub rate-limit failure.
func IsRateLimited(err error) bool {
	var rl *RateLimitError
	return errors.As(err, &rl)
}

// stripRoot removes the "repo-sha/" prefix codeload puts on every entry.
// Entries without it (pax_global_header) report ok=false.
func stripRoot(name string) (rel string, ok bool) {
	_, rest, found := strings.Cut(name, "/")
	return strings.TrimSuffix(rest, "/"), found
}

// CheckoutDir is where Checkout keeps rawURL's working copy. It only computes
// the path — callers that must not download (a request handler) can Stat it.
// base comes from TERRA_CHECKOUT_DIR (Compose: /data/checkouts) so the API
// container and preview sandboxes share the same files; empty uses the user
// cache dir.
func CheckoutDir(base, rawURL string) (string, error) {
	owner, repo, err := ownerRepo(rawURL)
	if err != nil {
		return "", err
	}
	name := owner + "-" + repo
	if base != "" {
		return filepath.Join(base, name), nil
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cache, "terra", "checkouts", name), nil
}

// checkoutMarker records which commit a checkout was extracted from.
const checkoutMarker = ".terra-commit"

// Checkout extracts (or reuses) a persistent working copy for previews from
// the commit tarball. No git involved and no .git directory on disk.
func Checkout(base, rawURL string) (string, error) {
	owner, repo, err := ownerRepo(rawURL)
	if err != nil {
		return "", err
	}
	dir, err := CheckoutDir(base, rawURL)
	if err != nil {
		return "", err
	}
	// Reuse an existing checkout (.git marks pre-tarball clones).
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

// RepoMeta fetches the cheap GitHub metadata behind the provisional model
// recommendation: the repo's primary language and its size in KB. It costs
// one API call and callers treat failure as "no signal yet", never fatal.
func RepoMeta(rawURL string) (language string, sizeKB int64, err error) {
	owner, repo, err := ownerRepo(rawURL)
	if err != nil {
		return "", 0, err
	}
	req, err := http.NewRequest("GET", apiBase+"/repos/"+owner+"/"+repo, nil)
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	setGitHubAuth(req)
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode != http.StatusOK {
		return "", 0, githubAPIError("metadata", owner, repo, resp, body)
	}
	var meta struct {
		Language string `json:"language"`
		Size     int64  `json:"size"`
	}
	if err := json.Unmarshal(body, &meta); err != nil {
		return "", 0, fmt.Errorf("metadata %s/%s: %w", owner, repo, err)
	}
	return meta.Language, meta.Size, nil
}
