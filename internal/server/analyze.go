package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/Enizri/terra/internal/analysis"
	"github.com/Enizri/terra/internal/analyzerclient"
	"github.com/Enizri/terra/internal/job"
	"github.com/Enizri/terra/internal/scan"
	"github.com/Enizri/terra/internal/store"
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
	if !s.acquireAnalyze() {
		s.analyzeBusy(w)
		return
	}
	if strings.Contains(r.Header.Get("Accept"), "application/x-ndjson") {
		s.analyzeStream(w, r.Context(), req.RepoURL, req.Model, s.releaseAnalyze)
		return
	}
	defer s.releaseAnalyze()

	// Commit lookup before tarball: repeat visits skip the download.
	var sha string
	if canonical, _, commit, err := s.Resolve(req.RepoURL); err == nil {
		sha = commit
		if repoMap := s.cachedAt(canonical, sha); repoMap != nil {
			writeJSON(w, repoMap)
			return
		}
	}

	res, err := s.Scan(req.RepoURL, sha)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	if repoMap := s.cached(res); repoMap != nil {
		writeJSON(w, repoMap)
		return
	}
	repoMap, warnings, err := s.Analyze(r.Context(), res, analyzerclient.LLMOpts{Model: req.Model})
	if err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	for _, warn := range warnings {
		fmt.Fprintln(os.Stderr, "warning:", warn)
	}
	if s.DB != "" {
		if err := store.Save(s.DB, res, repoMap); err != nil {
			httpError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	writeJSON(w, repoMap)
}

// analyzeStream runs analyze as a job and writes NDJSON events on this response.
// done releases the caller's analyze slot when the job finishes.
func (s *Server) analyzeStream(w http.ResponseWriter, ctx context.Context, repoURL, model string, done func()) {
	// Legacy path: no picker, so the analyzer keeps its own environment.
	j := s.startAnalyzeJob(analyzeJob{
		repoURL: repoURL,
		sel:     modelSelection{Opts: analyzerclient.LLMOpts{Model: model}},
	}, done)
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
		if work.cached = s.readProbe(req.ProbeID); work.cached == nil {
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
	return s.Jobs.Start(func(jobCtx context.Context, emit func(job.Event)) {
		defer done() // release the analyze slot on every exit, panic included
		ctx, cancel := context.WithTimeout(jobCtx, timeout)
		defer cancel()

		res := work.cached
		if res == nil {
			label := work.fetchLabel
			if label == "" {
				label = "Fetching " + repoURL
			}
			emit(job.Event{Stage: "fetch", Label: label})
			if err := ctx.Err(); err != nil {
				emit(job.Event{Stage: "error", Label: stopLabel(ctx, timeout)})
				return
			}

			// Resolve HEAD first so a commit-keyed cache hit never downloads the tree.
			canonical, _, sha, err := s.Resolve(repoURL)
			if err != nil {
				emit(job.Event{Stage: "error", Label: err.Error()})
				return
			}
			if repoMap := s.cachedAt(canonical, sha); repoMap != nil {
				emit(job.Event{Stage: "done", Map: repoMap})
				return
			}

			res, err = s.Scan(repoURL, sha)
			if err != nil {
				emit(job.Event{Stage: "error", Label: err.Error()})
				return
			}
		}
		emit(job.Event{
			Stage: "scan",
			Label: fmt.Sprintf("Read %d files across %d languages",
				res.Stats.SourceFiles, len(res.Languages)),
			Map: analysis.FromScan(res),
		})
		// Belt-and-suspenders: Scan may see a newer commit than Resolve raced.
		if repoMap := s.cached(res); repoMap != nil {
			emit(job.Event{Stage: "done", Map: repoMap})
			return
		}
		if err := ctx.Err(); err != nil {
			emit(job.Event{Stage: "error", Label: stopLabel(ctx, timeout)})
			return
		}
		// Local weights may not be on the host yet; the sidecar downloads and
		// loads them before the analyzer is allowed to call it.
		if sel.Local {
			if err := s.ensureModel(ctx, sel.HFID, emit); err != nil {
				if ctx.Err() != nil {
					emit(job.Event{Stage: "error", Label: stopLabel(ctx, timeout)})
					return
				}
				emit(job.Event{Stage: "error", Label: err.Error()})
				return
			}
		}
		emit(job.Event{Stage: "analyze", Label: "Terra is reading the architecture"})
		repoMap, warnings, err := s.Analyze(ctx, res, sel.Opts)
		if err != nil {
			if ctx.Err() != nil {
				emit(job.Event{Stage: "error", Label: stopLabel(ctx, timeout)})
				return
			}
			// Keep the structural map on the client; surface the failure as an
			// event — with any echoed key material stripped out first.
			emit(job.Event{Stage: "error", Label: scrub(err.Error(), sel.Opts.APIKey)})
			return
		}
		for _, warn := range warnings {
			fmt.Fprintln(os.Stderr, "warning:", warn)
		}
		if err := ctx.Err(); err != nil {
			emit(job.Event{Stage: "error", Label: stopLabel(ctx, timeout)})
			return
		}
		if s.DB != "" {
			emit(job.Event{
				Stage: "store",
				Label: fmt.Sprintf("Saving %d components", len(repoMap.Components)),
			})
			if err := store.Save(s.DB, res, repoMap); err != nil {
				emit(job.Event{Stage: "error", Label: err.Error()})
				return
			}
		}
		emit(job.Event{Stage: "done", Map: repoMap})
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
