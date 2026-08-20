package server

import (
	"context"
	"net/http"

	analyzepipeline "github.com/Enizri/terra/backend/api/internal/analyze"
	"github.com/Enizri/terra/backend/api/internal/job"
	"github.com/Enizri/terra/backend/api/internal/scan"
)

// enqueueProbe starts the cheap first half of an analyze: fetch, scan, and a
// model recommendation, with no LLM call or analyze concurrency slot.
func (s *Server) enqueueProbe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RepoURL string `json:"repo_url"`
	}
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
	j := s.startProbeJob(req.RepoURL)
	writeJSON(w, map[string]string{"job_id": j.ID})
}

func (s *Server) startProbeJob(repoURL string) *job.Job {
	timeout := s.Cfg.AnalyzeTimeout
	runner := analyzepipeline.ProbeRunner{
		Resolve:  s.Resolve,
		Scan:     s.Scan,
		RepoMeta: s.RepoMeta,
		Host:     s.Host,
		DB:       s.DB,
		Cache:    s.Probes,
	}
	return s.Jobs.Start(func(jobCtx context.Context, emit func(job.Event)) {
		ctx, cancel := context.WithTimeout(jobCtx, timeout)
		defer cancel()
		if err := runner.Run(ctx, repoURL, emit); err != nil {
			label := err.Error()
			if ctx.Err() != nil {
				label = stopLabel(ctx, timeout)
			}
			emit(job.Event{Stage: "error", Label: label})
		}
	})
}
