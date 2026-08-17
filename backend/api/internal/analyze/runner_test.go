package analyze

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/Enizri/terra/backend/api/internal/analysis"
	"github.com/Enizri/terra/backend/api/internal/analyzerclient"
	"github.com/Enizri/terra/backend/api/internal/scan"
	"github.com/Enizri/terra/backend/api/internal/store"
)

func TestRunUsesResolvedCacheBeforeScan(t *testing.T) {
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

	runner := &Runner{
		DB: db,
		Resolve: func(string) (string, string, string, error) {
			return res.RepositoryURL, res.Name, res.Commit, nil
		},
		Scan: func(string, string) (*scan.Result, error) {
			t.Fatal("cache hit must skip scan")
			return nil, nil
		},
		Analyze: func(context.Context, *scan.Result, analyzerclient.LLMOpts) (*analysis.Map, []string, error) {
			t.Fatal("cache hit must skip analyze")
			return nil, nil, nil
		},
	}

	got, err := runner.Run(context.Background(), res.RepositoryURL, analyzerclient.LLMOpts{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Cached || got.Map.Project.RepositoryURL != res.RepositoryURL {
		t.Fatalf("got %+v", got)
	}
}
