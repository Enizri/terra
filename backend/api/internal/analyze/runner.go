// Package analyze owns the probe→scan→LLM-map→persist workflow.
// HTTP and job streaming stay in internal/server; this package is the
// feature module those adapters call.
package analyze

import (
	"context"
	"fmt"
	"log"

	"github.com/Enizri/terra/backend/api/internal/analysis"
	"github.com/Enizri/terra/backend/api/internal/analyzerclient"
	"github.com/Enizri/terra/backend/api/internal/job"
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

// Background configures progress and optional local-model setup for a job run.
type Background struct {
	FetchLabel  string
	EnsureModel func(context.Context, func(job.Event)) error
	Emit        func(job.Event)
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
	// Timings is the per-stage wall clock of this run, in the order the
	// stages ran. Callers surface it; nothing in the pipeline branches on it.
	Timings []job.StageTiming
}

// Run executes scan → analyze → optional store. If cached is non-nil it is
// used as the scan (probe reuse) and fetch/scan are skipped.
func (r *Runner) Run(ctx context.Context, repoURL string, opts analyzerclient.LLMOpts, cached *scan.Result) (*Result, error) {
	return r.run(ctx, repoURL, opts, cached, nil)
}

// RunBackground runs the same pipeline with progress events for a queued job.
func (r *Runner) RunBackground(ctx context.Context, repoURL string, opts analyzerclient.LLMOpts, cached *scan.Result, bg Background) (*Result, error) {
	return r.run(ctx, repoURL, opts, cached, &bg)
}

func (r *Runner) run(ctx context.Context, repoURL string, opts analyzerclient.LLMOpts, cached *scan.Result, bg *Background) (*Result, error) {
	clock := newClock()
	// Every event leaves through here so the elapsed stamp cannot be forgotten
	// on one branch and present on another.
	emit := func(ev job.Event) {
		if bg == nil {
			return
		}
		ev.ElapsedMS = clock.elapsed().Milliseconds()
		bg.Emit(ev)
	}
	fail := func(stage string, err error) (*Result, error) {
		clock.stop(stage)
		log.Printf("terra: analyze %s failed at %s: %s", repoURL, stage, clock.summary())
		return nil, &Error{Stage: stage, Err: err}
	}
	finish := func(res *Result) (*Result, error) {
		res.Timings = clock.stages
		log.Printf("terra: analyze %s %s", repoURL, clock.summary())
		return res, nil
	}

	res := cached
	if res == nil {
		if bg != nil {
			label := bg.FetchLabel
			if label == "" {
				label = "Fetching " + repoURL
			}
			emit(job.Event{Stage: "fetch", Label: label})
			if err := ctx.Err(); err != nil {
				return fail("context", err)
			}
		}
		commit := ""
		if r.Resolve != nil {
			canonical, _, resolved, err := r.Resolve(repoURL)
			clock.stop("resolve")
			if err != nil && bg != nil {
				return fail("scan", err)
			}
			if err == nil {
				commit = resolved
			}
			if err == nil {
				if m := cachedAt(r.DB, canonical, commit); m != nil {
					clock.stop("cache")
					return finish(&Result{Map: m, Cached: true})
				}
				clock.stop("cache")
			}
		}
		var err error
		res, err = r.Scan(repoURL, commit)
		if err != nil {
			return fail("scan", err)
		}
		clock.stop("scan")
	} else {
		// Probe reuse: the fetch and scan were already paid for at the gate.
		clock.skip()
	}
	if bg != nil {
		emit(job.Event{
			Stage: "scan",
			Label: fmt.Sprintf("Read %d files across %d languages", res.Stats.SourceFiles, len(res.Languages)),
			Map:   ProvisionalMap(res),
		})
		clock.stop("provisional_map")
	}
	if r.DB != "" {
		if m := cachedAt(r.DB, res.RepositoryURL, res.Commit); m != nil {
			clock.stop("cache")
			return finish(&Result{Map: m, Scan: res, Cached: true})
		}
		clock.stop("cache")
	}
	if err := ctx.Err(); err != nil {
		return fail("context", err)
	}
	if bg != nil && bg.EnsureModel != nil {
		if err := bg.EnsureModel(ctx, emit); err != nil {
			return fail("ensure_model", err)
		}
		clock.stop("ensure_model")
	}
	if bg != nil {
		emit(job.Event{Stage: "analyze", Label: "Terra is reading the architecture"})
	}
	repoMap, warnings, err := r.Analyze(ctx, res, opts)
	if err != nil {
		return fail("analyze", err)
	}
	clock.stop("analyze")
	if err := ctx.Err(); err != nil {
		return fail("context", err)
	}
	if r.DB != "" {
		if bg != nil {
			emit(job.Event{Stage: "store", Label: fmt.Sprintf("Saving %d components", len(repoMap.Components))})
		}
		if err := store.Save(r.DB, res, repoMap); err != nil {
			return fail("store", fmt.Errorf("store: %w", err))
		}
		clock.stop("store")
	}
	return finish(&Result{Map: repoMap, Warnings: warnings, Scan: res})
}

func cachedAt(db, repoURL, commit string) *analysis.Map {
	if db == "" || repoURL == "" || commit == "" {
		return nil
	}
	stored, repoMap, err := store.Find(db, repoURL)
	if err != nil || stored != commit {
		return nil
	}
	return repoMap
}

// ProvisionalMap builds the structural map shown during the scan stage.
func ProvisionalMap(res *scan.Result) *analysis.Map {
	return analysis.FromScan(res)
}
