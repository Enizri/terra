package server

import (
	"context"
	"net/http"
	"strings"

	"github.com/Enizri/terra/backend/api/internal/job"
	"github.com/Enizri/terra/backend/api/internal/preview"
	"github.com/Enizri/terra/backend/api/internal/scan"
)

// enqueuePreview starts a preview boot as a job so the UI can show
// checkout → detect → install → boot → ready and cancel it.
func (s *Server) enqueuePreview(w http.ResponseWriter, r *http.Request) {
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
	repoURL := req.RepoURL
	j := s.Jobs.Start(func(ctx context.Context, emit func(job.Event)) {
		if err := ctx.Err(); err != nil {
			emit(job.Event{Stage: "error", Label: "cancelled"})
			return
		}
		res, err := s.previewRunner().Boot(repoURL, func(stage, label string) {
			if ctx.Err() != nil {
				return
			}
			emit(job.Event{Stage: stage, Label: label})
		})
		if err != nil {
			if ctx.Err() != nil {
				emit(job.Event{Stage: "error", Label: "cancelled"})
				return
			}
			emit(job.Event{Stage: "error", Label: err.Error()})
			return
		}
		if ctx.Err() != nil {
			emit(job.Event{Stage: "error", Label: "cancelled"})
			return
		}
		emit(job.Event{Stage: "ready", Label: res.URL, Preview: res})
		emit(job.Event{Stage: "done", Answer: res.URL, Preview: res})
	})
	writeJSON(w, map[string]string{"job_id": j.ID})
}

// enqueuePreviewTest runs the checkout's test script as a job (package stage).
func (s *Server) enqueuePreviewTest(w http.ResponseWriter, r *http.Request) {
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
	root, _, ok := s.previewRunner().Lookup(req.RepoURL)
	if !ok {
		httpError(w, http.StatusConflict, "preview is not mounted; open live preview first")
		return
	}
	dir := root
	j := s.Jobs.Start(func(ctx context.Context, emit func(job.Event)) {
		emit(job.Event{Stage: "boot", Label: "Running tests"})
		out, err := preview.RunTests(ctx, dir)
		if err != nil && out == "" {
			emit(job.Event{Stage: "error", Label: err.Error()})
			return
		}
		label := out
		if err != nil {
			label = err.Error() + "\n" + out
		}
		emit(job.Event{Stage: "done", Label: label, Answer: label})
	})
	writeJSON(w, map[string]string{"job_id": j.ID})
}

// enqueuePreviewCLI runs the checkout's CLI with typed argv (or --help).
func (s *Server) enqueuePreviewCLI(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RepoURL string `json:"repo_url"`
		Args    string `json:"args"`
	}
	if !decodeBody(w, r, &req, `body must be {"repo_url": "...", "args": "..."}`) {
		return
	}
	if req.RepoURL == "" {
		httpError(w, http.StatusBadRequest, `body must be {"repo_url": "github.com/user/project"}`)
		return
	}
	extra, err := preview.ParseCLIArgs(req.Args)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	root, _, ok := s.previewRunner().Lookup(req.RepoURL)
	if !ok {
		httpError(w, http.StatusConflict, "preview is not mounted; open live preview first")
		return
	}
	dir := root
	help := extra == nil
	j := s.Jobs.Start(func(ctx context.Context, emit func(job.Event)) {
		emit(job.Event{Stage: "boot", Label: "Running the CLI"})
		out, runErr := preview.RunCLI(ctx, dir, extra)
		if help && (runErr != nil || strings.TrimSpace(out) == "") {
			out2, err2 := preview.RunCLI(ctx, dir, []string{"-h"})
			if err2 == nil || out2 != "" {
				out, runErr = out2, err2
			}
		}
		if runErr != nil && out == "" {
			emit(job.Event{Stage: "error", Label: runErr.Error()})
			return
		}
		label := out
		if runErr != nil {
			label = runErr.Error() + "\n" + out
		}
		emit(job.Event{Stage: "done", Label: label, Answer: label})
	})
	writeJSON(w, map[string]string{"job_id": j.ID})
}
