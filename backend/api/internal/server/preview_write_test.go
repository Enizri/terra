package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/Enizri/terra/backend/api/internal/trace"
)

type writePreview struct {
	restarts int
	patches  int
	lastPath string
	lastDiff string
	patchErr error
	ready    bool
}

func (w *writePreview) Start(string) (string, error) { return "http://preview.test/", nil }
func (w *writePreview) Lookup(string) (string, string, bool) {
	return "", "", w.ready
}
func (w *writePreview) ApplyPatch(_, path, diff string) error {
	w.patches++
	w.lastPath, w.lastDiff = path, diff
	return w.patchErr
}
func (w *writePreview) Restart(string) error {
	w.restarts++
	return nil
}
func (*writePreview) StopAll() {}

func TestPreviewPatchForwardsBody(t *testing.T) {
	s, ts := testServer(t)
	stub := &writePreview{ready: true}
	s.Preview = stub

	body := `{"repo_url":"https://github.com/acme/notes","path":"web/src/App.tsx","unified_diff":"@@ -1,1 +1,1 @@\n-a\n+b\n"}`
	resp, err := http.Post(ts.URL+"/preview/patch", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d body = %s", resp.StatusCode, raw)
	}
	if stub.patches != 1 || stub.lastPath != "web/src/App.tsx" || !strings.Contains(stub.lastDiff, "+b") {
		t.Fatalf("forwarded path=%q diff=%q patches=%d", stub.lastPath, stub.lastDiff, stub.patches)
	}
}

func TestPreviewPatchRejectsEscape(t *testing.T) {
	s, ts := testServer(t)
	s.Preview = &writePreview{ready: true, patchErr: fmt.Errorf("path escapes the repository")}

	body := `{"repo_url":"https://github.com/acme/notes","path":"../etc/passwd","unified_diff":"@@ -0,0 +1,1 @@\n+x\n"}`
	resp, err := http.Post(ts.URL+"/preview/patch", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestPreviewPatchSizeCap(t *testing.T) {
	s, ts := testServer(t)
	s.Preview = &writePreview{ready: true, patchErr: fmt.Errorf("patch too large")}

	body, _ := json.Marshal(map[string]string{
		"repo_url":     "https://github.com/acme/notes",
		"path":         "big.txt",
		"unified_diff": "@@ -0,0 +1,1 @@\n+" + strings.Repeat("x", 32) + "\n",
	})
	resp, err := http.Post(ts.URL+"/preview/patch", "application/json", strings.NewReader(string(body)))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d body = %s, want 413", resp.StatusCode, raw)
	}
}

func TestPreviewRestartStopsThenStarts(t *testing.T) {
	s, ts := testServer(t)
	stub := &writePreview{ready: true}
	s.Preview = stub

	resp, err := http.Post(ts.URL+"/preview/restart", "application/json",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d body = %s", resp.StatusCode, raw)
	}
	if stub.restarts != 1 {
		t.Fatalf("restarts = %d", stub.restarts)
	}
}

func TestPreviewWriteRoutesTokenGated(t *testing.T) {
	t.Setenv("TERRA_TOKEN", "test-secret")
	_, ts := testServer(t)
	for _, path := range []string{"/preview/patch", "/preview/restart"} {
		resp, err := http.Post(ts.URL+path, "application/json",
			strings.NewReader(`{"repo_url":"https://github.com/acme/notes","path":"a.ts","unified_diff":"@@ -0,0 +1,1 @@\n+x\n"}`))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s no token: %d, want 401", path, resp.StatusCode)
		}

		req, err := http.NewRequest("POST", ts.URL+path+"?token=test-secret",
			strings.NewReader(`{"repo_url":"https://github.com/acme/notes","path":"a.ts","unified_diff":"@@ -0,0 +1,1 @@\n+x\n"}`))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err = http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s query token: %d, want 401", path, resp.StatusCode)
		}

		req, err = http.NewRequest("POST", ts.URL+path, strings.NewReader(`{"repo_url":"https://github.com/acme/notes"}`))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Terra-Token", trace.IngestToken())
		resp, err = http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s ingest token: %d, want 401", path, resp.StatusCode)
		}
	}
}
