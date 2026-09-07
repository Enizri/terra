package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	analyzepipeline "github.com/Enizri/terra/backend/api/internal/analyze"
	"github.com/Enizri/terra/backend/api/internal/job"
	"github.com/Enizri/terra/backend/api/internal/scan"
)

// acquireAnalyze claims a slot without blocking; callers 429 when full.
func (s *Server) acquireAnalyze() bool {
	select {
	case s.analyzeSlots <- struct{}{}:
		return true
	default:
		return false
	}
}

func (s *Server) releaseAnalyze() { <-s.analyzeSlots }

func (s *Server) analyzeBusy(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "30")
	httpError(w, http.StatusTooManyRequests,
		fmt.Sprintf("analyze is at capacity (%d in flight); try again shortly", cap(s.analyzeSlots)))
}

func (s *Server) analyze(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RepoURL string `json:"repo_url"`
		Model   string `json:"model"`
	}
	if !decodeBody(w, r, &req, `body must be {"repo_url": "github.com/user/project"}`) {
		return
	}
	if req.RepoURL == "" {
		httpError(w, http.StatusBadRequest, `body must be {"repo_url": "github.com/user/project"}`)
		return
	}
	// Validate before streaming: NDJSON commits status 200.
	if _, _, err := scan.NormalizeURL(req.RepoURL); err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	// This route has no picker, so it names no model and runs on the
	// analyzer's own environment. Routed through selectModel anyway: that is
	// where TERRA_REQUIRE_MODEL refuses an unrouted request, and this path
	// spends the operator's key exactly like the enqueue one.
	sel, ok := s.selectModel(w, "", "", req.Model)
	if !ok {
		return
	}
	if !s.acquireAnalyze() {
		s.analyzeBusy(w)
		return
	}
	if strings.Contains(r.Header.Get("Accept"), "application/x-ndjson") {
		s.analyzeStream(w, r.Context(), req.RepoURL, sel, s.releaseAnalyze)
		return
	}
	defer s.releaseAnalyze()

	result, err := (&analyzepipeline.Runner{
		Resolve: s.Resolve,
		Scan:    s.Scan,
		Analyze: s.Analyze,
		DB:      s.DB,
	}).Run(r.Context(), req.RepoURL, sel.Opts, nil)
	if err != nil {
		status := http.StatusInternalServerError
		var pipelineErr *analyzepipeline.Error
		if errors.As(err, &pipelineErr) {
			switch pipelineErr.Stage {
			case "scan":
				status = http.StatusBadRequest
			case "analyze":
				status = http.StatusBadGateway
			}
		}
		httpError(w, status, err.Error())
		return
	}
	for _, warn := range result.Warnings {
		fmt.Fprintln(os.Stderr, "warning:", warn)
	}
	writeJSON(w, result.Map)
}

// analyzeStream runs analyze as a job and writes NDJSON events on this response.
// done releases the caller's analyze slot when the job finishes.
func (s *Server) analyzeStream(w http.ResponseWriter, ctx context.Context, repoURL string, sel modelSelection, done func()) {
	// Legacy path: sel carries no routing, so the analyzer keeps its own
	// environment. The caller has already passed it through selectModel.
	j := s.startAnalyzeJob(analyzeJob{repoURL: repoURL, sel: sel}, done)
	s.streamJobEvents(w, ctx, j)
}

// analyzeRequest is the enqueue body. Model is the legacy free-form override;
// ModelID names a catalog entry and is what the workspace picker sends.
//
// APIKey is request-scoped BYOK material. It is read here, handed to the
// analyzer, and dropped — never stored, logged, or put on a job event.
type analyzeRequest struct {
	RepoURL string `json:"repo_url"`
	ProbeID string `json:"probe_id"`
	ModelID string `json:"model_id"`
	APIKey  string `json:"api_key"`
	Model   string `json:"model"`
}

// enqueueAnalyze starts an analyze job and returns its id.
func (s *Server) enqueueAnalyze(w http.ResponseWriter, r *http.Request) {
	var req analyzeRequest
	if !decodeBody(w, r, &req, `body must be {"repo_url": "github.com/user/project"}`) {
		return
	}
	if req.RepoURL == "" {
		httpError(w, http.StatusBadRequest, `body must be {"repo_url": "github.com/user/project"}`)
		return
	}
	if _, _, err := scan.NormalizeURL(req.RepoURL); err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	sel, ok := s.selectModel(w, req.ModelID, req.APIKey, req.Model)
	if !ok {
		return
	}
	// Claim the slot before returning the job id: once the id is out, a
	// failure can only surface as an event, never a 429.
	if !s.acquireAnalyze() {
		s.analyzeBusy(w)
		return
	}
	// A probe within its TTL already did the fetch and scan; a miss just
	// means the job does that work itself, and says so.
	work := analyzeJob{repoURL: req.RepoURL, sel: sel}
	if req.ProbeID != "" {
		if work.cached = s.Probes.Read(req.ProbeID); work.cached == nil {
			work.fetchLabel = "Probe expired — rescanning " + req.RepoURL
		}
	}
	j := s.startAnalyzeJob(work, s.releaseAnalyze)
	writeJSON(w, map[string]string{"job_id": j.ID})
}

func (s *Server) jobEvents(w http.ResponseWriter, r *http.Request) {
	j := s.Jobs.Get(r.PathValue("id"))
	if j == nil {
		httpError(w, http.StatusNotFound, "unknown job")
		return
	}
	s.streamJobEvents(w, r.Context(), j)
}

func (s *Server) cancelJob(w http.ResponseWriter, r *http.Request) {
	j := s.Jobs.Get(r.PathValue("id"))
	if j == nil {
		httpError(w, http.StatusNotFound, "unknown job")
		return
	}
	j.Cancel()
	w.WriteHeader(http.StatusNoContent)
}

// analyzeJob is one analyze run's inputs.
type analyzeJob struct {
	repoURL string
	sel     modelSelection
	// cached is a probe's scan being reused; non-nil skips fetch and scan.
	cached *scan.Result
	// fetchLabel overrides the fetch stage copy (probe expired → rescanning).
	fetchLabel string
}

func (s *Server) startAnalyzeJob(work analyzeJob, done func()) *job.Job {
	timeout := s.Cfg.AnalyzeTimeout
	repoURL, sel := work.repoURL, work.sel
	runner := analyzepipeline.Runner{Resolve: s.Resolve, Scan: s.Scan, Analyze: s.Analyze, DB: s.DB}
	return s.Jobs.Start(func(jobCtx context.Context, emit func(job.Event)) {
		defer done() // release the analyze slot on every exit, panic included
		ctx, cancel := context.WithTimeout(jobCtx, timeout)
		defer cancel()
		safeEmit := func(ev job.Event) {
			ev.Label = scrub(ev.Label, sel.Opts.APIKey)
			emit(ev)
		}
		var ensure func(context.Context, func(job.Event)) error
		if sel.Local {
			ensure = func(ctx context.Context, emit func(job.Event)) error {
				return s.ensureModel(ctx, sel.HFID, emit)
			}
		}
		result, err := runner.RunBackground(ctx, repoURL, sel.Opts, work.cached, analyzepipeline.Background{
			FetchLabel: work.fetchLabel, EnsureModel: ensure, Emit: safeEmit,
		})
		if err != nil {
			label := err.Error()
			if ctx.Err() != nil {
				label = stopLabel(ctx, timeout)
			}
			safeEmit(job.Event{Stage: "error", Label: label})
			return
		}
		for _, warn := range result.Warnings {
			fmt.Fprintln(os.Stderr, "warning:", warn)
		}
		// The terminal event carries the per-stage breakdown: a user who waited
		// too long can see which stage spent it without reading server logs.
		safeEmit(job.Event{Stage: "done", Map: result.Map, Timings: result.Timings})
	})
}

// streamJobEvents writes job events as NDJSON (history first, then live).
func (s *Server) streamJobEvents(w http.ResponseWriter, ctx context.Context, j *job.Job) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	enc := json.NewEncoder(w)
	send := func(ev job.Event) {
		enc.Encode(ev)
		flusher.Flush()
	}

	history, ch, unsub := j.Subscribe()
	defer unsub()
	for _, ev := range history {
		send(ev)
	}
	for {
		select {
		case ev, ok := <-ch:
			if !ok {
				return
			}
			send(ev)
		case <-ctx.Done():
			return
		}
	}
}
