package scan

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

var githubRe = regexp.MustCompile(`^(?:https://github\.com/|git@github\.com:|github\.com/)([\w.-]+)/([\w.-]+?)(?:\.git)?(?:/.*)?$`)

// NormalizeURL turns any common GitHub repo reference into a canonical
// https clone URL and returns it with the repo name.
func NormalizeURL(raw string) (url, name string, err error) {
	m := githubRe.FindStringSubmatch(strings.TrimSpace(raw))
	if m == nil {
		return "", "", fmt.Errorf("not a GitHub repository URL: %q (expected https://github.com/owner/repo)", raw)
	}
	return "https://github.com/" + m[1] + "/" + m[2], m[2], nil
}

// CheckoutDir is where Checkout keeps rawURL's working copy. It only computes
// the path — callers that must not clone (a request handler) can Stat it.
func CheckoutDir(rawURL string) (string, error) {
	m := githubRe.FindStringSubmatch(strings.TrimSpace(rawURL))
	if m == nil {
		return "", fmt.Errorf("not a GitHub repository URL: %q (expected https://github.com/owner/repo)", rawURL)
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cache, "terra", "checkouts", m[1]+"-"+m[2]), nil
}

// Checkout clones (or reuses) a persistent working copy for previews.
func Checkout(rawURL string) (string, error) {
	m := githubRe.FindStringSubmatch(strings.TrimSpace(rawURL))
	if m == nil {
		return "", fmt.Errorf("not a GitHub repository URL: %q (expected https://github.com/owner/repo)", rawURL)
	}
	dir, err := CheckoutDir(rawURL)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
		// ponytail: no git pull; a stale checkout is fine for an MVP preview
		return dir, nil
	}
	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return "", err
	}
	if _, err := clone("https://github.com/"+m[1]+"/"+m[2], dir); err != nil {
		os.RemoveAll(dir)
		return "", err
	}
	return dir, nil
}

// clone does a shallow clone into dir and returns the HEAD commit hash.
func clone(url, dir string) (commit string, err error) {
	out, err := exec.Command("git", "clone", "--depth", "1", "--quiet", url, dir).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git clone %s: %v: %s", url, err, strings.TrimSpace(string(out)))
	}
	out, err = exec.Command("git", "-C", dir, "rev-parse", "HEAD").Output()
	if err != nil {
		return "", fmt.Errorf("rev-parse HEAD: %v", err)
	}
	return strings.TrimSpace(string(out)), nil
}
