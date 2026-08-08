package scan

import (
	"os"
	"path/filepath"
	"testing"
)

// Live network test, opt-in: TERRA_LIVE=1 go test -run TestLiveCheckout ./internal/scan/
func TestLiveCheckoutNoGit(t *testing.T) {
	if os.Getenv("TERRA_LIVE") != "1" {
		t.Skip("set TERRA_LIVE=1 for live GitHub checkout test")
	}
	dir, err := Checkout("", "github.com/octocat/Hello-World")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
		t.Fatal(".git present in tarball checkout")
	}
	if CheckoutCommit(dir) == "" {
		t.Fatal("missing commit marker")
	}
	t.Log("checkout at", dir, "sha", CheckoutCommit(dir))
}
