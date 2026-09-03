package server

import (
	"net/http"
	"strings"

	"github.com/Enizri/terra/backend/api/internal/preview"
)

func (s *Server) previewRoutes(w http.ResponseWriter, r *http.Request) {
	repoURL := r.URL.Query().Get("repo_url")
	if repoURL == "" {
		httpError(w, http.StatusBadRequest, "repo_url is required")
		return
	}
	root, _, ok := s.previewRunner().Lookup(repoURL)
	if !ok {
		httpError(w, http.StatusConflict, "preview is not mounted; open live preview first")
		return
	}
	writeJSON(w, map[string]any{"routes": preview.DiscoverRoutes(root)})
}

func (s *Server) previewProbe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RepoURL string `json:"repo_url"`
		URL     string `json:"url"`
		Method  string `json:"method"`
		Path    string `json:"path"`
	}
	if !decodeBody(w, r, &req, `body must be {"repo_url":"...","url":"...","path":"/healthz"}`) {
		return
	}
	if req.RepoURL == "" || req.URL == "" {
		httpError(w, http.StatusBadRequest, `body must include repo_url and url`)
		return
	}
	if _, _, ok := s.previewRunner().Lookup(req.RepoURL); !ok {
		httpError(w, http.StatusConflict, "preview is not mounted; open live preview first")
		return
	}
	id, ok := preview.LiveID(req.URL)
	if !ok {
		httpError(w, http.StatusBadRequest, "url is not a Terra live preview")
		return
	}
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method == "" {
		method = http.MethodGet
	}
	hit, err := preview.ProbeLive(id, method, req.Path)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, hit)
}
