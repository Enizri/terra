package server

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/Enizri/terra/internal/job"
	"github.com/Enizri/terra/internal/preview"
	"github.com/Enizri/terra/internal/scan"
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
	sels := req.Selections
	if len(sels) == 0 && req.Selection != nil {
		sels = []map[string]any{req.Selection}
	}
	primary := req.Selection
	if primary == nil && len(sels) > 0 {
		primary = sels[len(sels)-1]
	}
	if primary == nil {
		primary = map[string]any{}
	}

	payload := map[string]any{"question": req.Question, "selection": primary}
	if sel.Opts.Model != "" {
		payload["model"] = sel.Opts.Model
		payload["base_url"] = sel.Opts.BaseURL
		if sel.Opts.APIKey != "" {
			payload["api_key"] = sel.Opts.APIKey
		}
	}
	if len(sels) > 1 {
		payload["selections"] = sels
	}
	if file, _ := primary["file"].(string); file != "" {
		line := 0
		if l, ok := primary["line"].(float64); ok {
			line = int(l)
		}
		if snip := snippet(s.previewRunner(), s.Cfg.CheckoutDir, req.RepoURL, file, line); snip != "" {
			payload["file_snippet"] = snip
		}
	}
	if s.DB != "" {
		if repoMap := storedMap(s.DB, req.RepoURL); repoMap != nil {
			payload["map"] = repoMap
		}
	}
	return payload
}

// snippet returns ~150 lines centered on line from an existing checkout.
// checkoutBase is Cfg.CheckoutDir.
func snippet(r preview.Runner, checkoutBase, repoURL, file string, line int) string {
	if strings.Contains(file, "..") {
		return ""
	}
	root, appDir, ok := r.Lookup(repoURL)
	if !ok {
		dir, err := scan.CheckoutDir(checkoutBase, repoURL)
		if err != nil {
			return ""
		}
		if _, err := os.Stat(dir); err != nil {
			return ""
		}
		root, appDir = dir, dir
	}
	for _, base := range []string{appDir, root} {
		data, err := os.ReadFile(filepath.Join(base, file))
		if err != nil {
			continue
		}
		lines := strings.Split(string(data), "\n")
		lo, hi := 0, len(lines)
		if line > 0 && hi > 150 {
			lo = max(0, line-75)
			hi = min(len(lines), line+75)
		} else if hi > 150 {
			hi = 150
		}
		return strings.Join(lines[lo:hi], "\n")
	}
	return ""
}
