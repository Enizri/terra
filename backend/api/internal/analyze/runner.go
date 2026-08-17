// Package analyze owns the probe→scan→LLM-map→persist workflow.
// HTTP and job streaming stay in internal/server; this package is the
// feature module those adapters call.
package analyze

import (
	"context"
	"fmt"

	"github.com/Enizri/terra/backend/api/internal/analysis"
	"github.com/Enizri/terra/backend/api/internal/analyzerclient"
	"github.com/Enizri/terra/backend/api/internal/scan"
	"github.com/Enizri/terra/backend/api/internal/store"
)

// ScanFunc resolves a repo into scan facts. commit may be empty.
type ScanFunc func(url, commit string) (*scan.Result, error)

// ResolveFunc resolves a repo URL to its canonical URL and HEAD commit.
type ResolveFunc func(url string) (canonicalURL, name, commit string, err error)

// AnalyzeFunc calls the Python analyzer and assembles a Map.
type AnalyzeFunc func(ctx context.Context, res *scan.Result, opts analyzerclient.LLMOpts) (*analysis.Map, []string, error)

// Runner runs one analyze pipeline against injected dependencies.
type Runner struct {
	Resolve ResolveFunc
	Scan    ScanFunc
	Analyze AnalyzeFunc
	DB      string // empty skips persistence
}

// Error identifies which pipeline stage failed while preserving the original message.
type Error struct {
	Stage string
	Err   error
}

func (e *Error) Error() string { return e.Err.Error() }
func (e *Error) Unwrap() error { return e.Err }

// Result is the outcome of a successful pipeline run.
type Result struct {
	Map      *analysis.Map
	Warnings []string
	Scan     *scan.Result
	Cached   bool
}

// Run executes scan → analyze → optional store. If cached is non-nil it is
// used as the scan (probe reuse) and fetch/scan are skipped.
func (r *Runner) Run(ctx context.Context, repoURL string, opts analyzerclient.LLMOpts, cached *scan.Result) (*Result, error) {
	res := cached
	if res == nil {
		commit := ""
		if r.Resolve != nil {
			canonical, _, resolved, err := r.Resolve(repoURL)
			if err == nil {
				commit = resolved
			}
			if err == nil && r.DB != "" {
				if storedCommit, m, err := store.Find(r.DB, canonical); err == nil && m != nil && storedCommit == commit {
					return &Result{Map: m, Cached: true}, nil
				}
			}
		}
		var err error
		res, err = r.Scan(repoURL, commit)
		if err != nil {
			return nil, &Error{Stage: "scan", Err: err}
		}
	}
	if r.DB != "" {
		if commit, m, err := store.Find(r.DB, res.RepositoryURL); err == nil && m != nil && commit == res.Commit {
			return &Result{Map: m, Scan: res, Cached: true}, nil
		}
	}
	repoMap, warnings, err := r.Analyze(ctx, res, opts)
	if err != nil {
		return nil, &Error{Stage: "analyze", Err: err}
	}
	if r.DB != "" {
		if err := store.Save(r.DB, res, repoMap); err != nil {
			return nil, &Error{Stage: "store", Err: fmt.Errorf("store: %w", err)}
		}
	}
	return &Result{Map: repoMap, Warnings: warnings, Scan: res}, nil
}

// ProvisionalMap builds the structural map shown during the scan stage.
func ProvisionalMap(res *scan.Result) *analysis.Map {
	return analysis.FromScan(res)
}
