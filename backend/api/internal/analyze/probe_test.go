package analyze

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/Enizri/terra/backend/api/internal/analysis"
	"github.com/Enizri/terra/backend/api/internal/catalog"
	"github.com/Enizri/terra/backend/api/internal/job"
	"github.com/Enizri/terra/backend/api/internal/scan"
	"github.com/Enizri/terra/backend/api/internal/store"
)

func TestProbeUsesResolvedCacheBeforeGitHub(t *testing.T) {
	db := filepath.Join(t.TempDir(), "terra.db")
	res := &scan.Result{
		RepositoryURL: "https://github.com/acme/repo",
		Name:          "repo",
		Commit:        "abc123",
		ScannedAt:     time.Now(),
	}
	repoMap := &analysis.Map{Project: analysis.Project{Name: "repo", RepositoryURL: res.RepositoryURL}}
	if err := store.Save(db, res, repoMap); err != nil {
		t.Fatal(err)
	}

	runner := &ProbeRunner{
		DB:    db,
		Cache: NewProbeCache(ProbeTTL),
		Host:  func() catalog.Capabilities { return catalog.Capabilities{RAMGB: 16, Device: "cpu"} },
		Resolve: func(string) (string, string, string, error) {
			return res.RepositoryURL, res.Name, res.Commit, nil
		},
		Scan: func(string, string) (*scan.Result, error) {
			t.Fatal("cache hit must skip the tarball")
			return nil, nil
		},
		RepoMeta: func(string) (string, int64, error) {
			t.Fatal("cache hit must skip GitHub metadata")
			return "", 0, nil
		},
	}

	var done job.Event
	if err := runner.Run(context.Background(), res.RepositoryURL, func(ev job.Event) {
		if ev.Stage == "done" {
			done = ev
		}
	}); err != nil {
		t.Fatal(err)
	}
	if done.Map == nil || done.Map.Project.RepositoryURL != res.RepositoryURL {
		t.Fatalf("done = %+v", done)
	}
	if done.ProbeID != "" {
		t.Fatal("a cached map is not a probe handle")
	}
	if len(done.Timings) == 0 {
		t.Fatal("cached probe still reports timings")
	}
}
