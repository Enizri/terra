package server

import (
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/Enizri/terra/backend/api/internal/scan"
	"github.com/Enizri/terra/backend/api/internal/trace"
)

// files lists a directory or reads a file under the preview frontend dir.
func (s *Server) files(w http.ResponseWriter, r *http.Request) {
	repoURL := r.URL.Query().Get("repo_url")
	if repoURL == "" {
		httpError(w, http.StatusBadRequest, "repo_url is required")
		return
	}
	_, appDir, ok := s.previewRunner().Lookup(repoURL)
	if !ok {
		writeJSON(w, map[string]any{"starting": true})
		return
	}
	full, rel, err := safeJoin(appDir, r.URL.Query().Get("path"))
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	info, err := os.Stat(full)
	if err != nil {
		httpError(w, http.StatusNotFound, "no such path")
		return
	}
	if !info.IsDir() {
		if info.Size() > 512<<10 {
			httpError(w, http.StatusRequestEntityTooLarge, "file too large to preview")
			return
		}
		data, err := os.ReadFile(full)
		if err != nil {
			httpError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, map[string]any{"path": rel, "content": string(data)})
		return
	}

	entries, err := os.ReadDir(full)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	type entry struct {
		Name string `json:"name"`
		Path string `json:"path"`
		Dir  bool   `json:"dir"`
	}
	out := []entry{}
	for _, ent := range entries {
		name := ent.Name()
		if name == ".git" || name == "node_modules" || strings.HasPrefix(name, ".") {
			continue
		}
		out = append(out, entry{Name: name, Path: path.Join(rel, name), Dir: ent.IsDir()})
	}
	slices.SortFunc(out, func(a, b entry) int {
		if a.Dir != b.Dir {
			if a.Dir {
				return -1
			}
			return 1
		}
		return strings.Compare(a.Name, b.Name)
	})
	writeJSON(w, map[string]any{"path": rel, "entries": out})
}

// ingest publishes spans from the preview hook. Repo and Time are set server-side.
func (s *Server) ingest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RepoURL string `json:"repo_url"`
		Spans   []struct {
			Kind   string `json:"kind"`
			Method string `json:"method"`
			Path   string `json:"path"`
			Status int    `json:"status"`
			DurMS  int64  `json:"dur_ms"`
		} `json:"spans"`
	}
	if !decodeBody(w, r, &req, `body must be {"repo_url": "...", "spans": [...]}`) {
		return
	}
	if req.RepoURL == "" {
		httpError(w, http.StatusBadRequest, `body must be {"repo_url": "...", "spans": [...]}`)
		return
	}
	key, _, err := scan.NormalizeURL(req.RepoURL)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.Spans) > 100 {
		req.Spans = req.Spans[:100]
	}
	now := time.Now()
	for _, sp := range req.Spans {
		if !trace.WorthKeeping(sp.Path) {
			continue
		}
		trace.Publish(trace.Span{
			Repo:   key,
			Time:   now,
			Method: sp.Method,
			Path:   sp.Path,
			Status: sp.Status,
			DurMS:  sp.DurMS,
			Kind:   sp.Kind,
		})
	}
	w.WriteHeader(http.StatusNoContent)
}

// safeJoin resolves rel under base and rejects path escape (including symlinks).
func safeJoin(base, rel string) (full, clean string, err error) {
	clean = path.Clean("/" + strings.TrimPrefix(rel, "/"))[1:]
	realBase, err := filepath.EvalSymlinks(base)
	if err != nil {
		return "", "", fmt.Errorf("preview checkout unavailable")
	}
	full = filepath.Join(realBase, filepath.FromSlash(clean))
	if realFull, err := filepath.EvalSymlinks(full); err == nil {
		relPath, err := filepath.Rel(realBase, realFull)
		if err != nil || relPath == ".." || strings.HasPrefix(relPath, ".."+string(filepath.Separator)) {
			return "", "", fmt.Errorf("path escapes the repository")
		}
	}
	return full, clean, nil
}
