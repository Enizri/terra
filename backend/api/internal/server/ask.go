package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	askcontext "github.com/Enizri/terra/backend/api/internal/ask"
	"github.com/Enizri/terra/backend/api/internal/job"
)

type askRequest struct {
	RepoURL    string           `json:"repo_url"`
	Question   string           `json:"question"`
	Selection  map[string]any   `json:"selection"`
	Selections []map[string]any `json:"selections"`
	// The workspace reuses the model it picked for this session. The sidecar
	// may have been switched since analyze ran, so the job path still calls
	// ensure_model rather than assuming the weights are resident.
	ModelID string `json:"model_id"`
	APIKey  string `json:"api_key"`
}

// ask answers synchronously; prefer POST /jobs/ask for the web client.
func (s *Server) ask(w http.ResponseWriter, r *http.Request) {
	req, sel, ok := s.decodeAsk(w, r)
	if !ok {
		return
	}
	data, err := s.RunTask(r.Context(), "qa", s.askPayload(req, sel))
	if err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// enqueueAsk starts a qa job and returns its id immediately.
func (s *Server) enqueueAsk(w http.ResponseWriter, r *http.Request) {
	req, sel, ok := s.decodeAsk(w, r)
	if !ok {
		return
	}
	payload := s.askPayload(req, sel)
	// Job events are replayed to every subscriber, so an analyzer error that
	// echoed the key back must be scrubbed before it becomes a label.
	key := strings.TrimSpace(req.APIKey)
	j := s.Jobs.Start(func(ctx context.Context, emit func(job.Event)) {
		emit(job.Event{Stage: "ask", Label: "Terra is reading the selection"})
		if err := ctx.Err(); err != nil {
			emit(job.Event{Stage: "error", Label: "cancelled"})
			return
		}
		// The sidecar may be serving something else by now — analyze having
		// loaded these weights once is not a guarantee.
		if sel.Local {
			if err := s.ensureModel(ctx, sel.HFID, emit); err != nil {
				if ctx.Err() != nil {
					emit(job.Event{Stage: "error", Label: "cancelled"})
					return
				}
				emit(job.Event{Stage: "error", Label: err.Error()})
				return
			}
		}
		data, err := s.RunTask(ctx, "qa", payload)
		if err != nil {
			emit(job.Event{Stage: "error", Label: scrub(err.Error(), key)})
			return
		}
		if err := ctx.Err(); err != nil {
			emit(job.Event{Stage: "error", Label: "cancelled"})
			return
		}
		var out struct {
			Answer string `json:"answer"`
		}
		answer := string(data)
		if json.Unmarshal(data, &out) == nil && out.Answer != "" {
			answer = out.Answer
		}
		emit(job.Event{Stage: "done", Answer: answer})
	})
	writeJSON(w, map[string]string{"job_id": j.ID})
}

// decodeAsk reads the body and resolves the picker fields through the same
// validation analyze uses: an unknown model_id or a missing BYOK key is a 400
// here rather than a failure deep inside the provider.
func (s *Server) decodeAsk(w http.ResponseWriter, r *http.Request) (askRequest, modelSelection, bool) {
	var req askRequest
	if !decodeBody(w, r, &req, `body must be {"repo_url": "...", "question": "...", "selection": {...}}`) {
		return req, modelSelection{}, false
	}
	if req.RepoURL == "" || req.Question == "" {
		httpError(w, http.StatusBadRequest, `body must be {"repo_url": "...", "question": "...", "selection": {...}}`)
		return req, modelSelection{}, false
	}
	sel, ok := s.selectModel(w, req.ModelID, req.APIKey, "")
	return req, sel, ok
}

func (s *Server) askPayload(req askRequest, sel modelSelection) map[string]any {
	return askcontext.BuildPayload(askcontext.Input{
		RepoURL: req.RepoURL, Question: req.Question,
		Selection: req.Selection, Selections: req.Selections,
		Model: sel.Opts, Preview: s.previewRunner(),
		CheckoutBase: s.Cfg.CheckoutDir, DB: s.DB,
	})
}
