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

// AnalyzeFunc calls the Python analyzer and assembles a Map.
type AnalyzeFunc func(ctx context.Context, res *scan.Result, opts analyzerclient.LLMOpts) (*analysis.Map, []string, error)

// Runner runs one analyze pipeline against injected dependencies.
type Runner struct {
	Scan    ScanFunc
	Analyze AnalyzeFunc
	DB      string // empty skips persistence
}

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
		var err error
		res, err = r.Scan(repoURL, "")
		if err != nil {
			return nil, err
		}
	}
	if r.DB != "" {
		if commit, m, err := store.Find(r.DB, res.RepositoryURL); err == nil && m != nil && commit == res.Commit {
			return &Result{Map: m, Scan: res, Cached: true}, nil
		}
	}
	repoMap, warnings, err := r.Analyze(ctx, res, opts)
	if err != nil {
		return nil, err
	}
	if r.DB != "" {
		if err := store.Save(r.DB, res, repoMap); err != nil {
			return nil, fmt.Errorf("store: %w", err)
		}
	}
	return &Result{Map: repoMap, Warnings: warnings, Scan: res}, nil
}

// ProvisionalMap builds the structural map shown during the scan stage.
func ProvisionalMap(res *scan.Result) *analysis.Map {
	return analysis.FromScan(res)
}
