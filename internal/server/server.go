// Package server exposes Terra over HTTP: analyze a repository, list past
// analyses, fetch one. Analysis is synchronous — the response is the full
// map, minutes later. Good enough until there is more than one user.
package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"terra/internal/graph"
	"terra/internal/preview"
	"terra/internal/scan"
	"terra/internal/store"
)

type Server struct {
	DB string
	// Scan and Analyze exist so tests can stub the clone and the analyzer;
	// zero values mean the real thing.
	Scan    func(url string) (*scan.Result, error)
	Analyze func(res *scan.Result, model string) (*graph.Map, []string, error)
}

func (s *Server) Handler() http.Handler {
	if s.Scan == nil {
		s.Scan = scan.Scan
	}
	if s.Analyze == nil {
		s.Analyze = graph.Analyze
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /analyze", s.analyze)
	mux.HandleFunc("GET /analyses", s.list)
	mux.HandleFunc("GET /analyses/{id}", s.get)
	mux.HandleFunc("POST /preview", s.preview)
	mux.HandleFunc("POST /ask", s.ask)
	mux.HandleFunc("GET /files", s.files)
	return mux
}

// ListenAndServe blocks. Timeouts stay off: a synchronous analysis holds the
// response open for minutes.
func (s *Server) ListenAndServe(addr string) error {
	fmt.Fprintf(os.Stderr, "terra API listening on %s\n", addr)
	return (&http.Server{Addr: addr, Handler: s.Handler()}).ListenAndServe()
}

func (s *Server) analyze(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RepoURL string `json:"repo_url"`
		Model   string `json:"model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RepoURL == "" {
		httpError(w, http.StatusBadRequest, `body must be {"repo_url": "github.com/user/project"}`)
		return
	}
	// Reject a bad URL here, while a status code is still on the table — once
	// the stream is flowing the response is already committed to 200.
	if _, _, err := scan.NormalizeURL(req.RepoURL); err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.Contains(r.Header.Get("Accept"), "application/x-ndjson") {
		s.analyzeStream(w, req.RepoURL, req.Model)
		return
	}

	res, err := s.Scan(req.RepoURL)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	m, warnings, err := s.Analyze(res, req.Model)
	if err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	for _, warn := range warnings {
		fmt.Fprintln(os.Stderr, "warning:", warn)
	}
	if s.DB != "" {
		if err := store.Save(s.DB, res, m); err != nil {
			httpError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	writeJSON(w, m)
}

// analyzeStream runs the same pipeline as analyze but reports each stage as
// it starts, one JSON object per line, flushed immediately. The UI shows the
// latest line; the response ends with a "done" event carrying the full map.
//
// ponytail: four stages, because they wrap the existing Scan/Analyze calls
// rather than reaching inside them. The analyze stage is the multi-minute one
// and reports nothing while it runs — the UI covers it with an elapsed timer.
// Per-phase callbacks in scan/ and the analyzer are the upgrade.
func (s *Server) analyzeStream(w http.ResponseWriter, repoURL, model string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	// Proxies that buffer would defeat the point of flushing.
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	enc := json.NewEncoder(w)
	send := func(ev map[string]any) {
		enc.Encode(ev)
		flusher.Flush()
	}
	// Past this point the status code is spent, so failures ride the stream.
	fail := func(err error) {
		send(map[string]any{"stage": "error", "label": err.Error()})
	}

	send(map[string]any{"stage": "clone", "label": "Cloning " + repoURL})
	res, err := s.Scan(repoURL)
	if err != nil {
		fail(err)
		return
	}

	send(map[string]any{
		"stage": "scan",
		"label": fmt.Sprintf("Read %d files across %d languages",
			res.Stats.SourceFiles, len(res.Languages)),
	})
	send(map[string]any{"stage": "analyze", "label": "Terra is reading the architecture"})
	m, warnings, err := s.Analyze(res, model)
	if err != nil {
		fail(err)
		return
	}
	for _, warn := range warnings {
		fmt.Fprintln(os.Stderr, "warning:", warn)
	}

	if s.DB != "" {
		send(map[string]any{
			"stage": "store",
			"label": fmt.Sprintf("Saving %d components", len(m.Components)),
		})
		if err := store.Save(s.DB, res, m); err != nil {
			fail(err)
			return
		}
	}
	send(map[string]any{"stage": "done", "map": m})
}

// preview starts (or reuses) a live dev-server preview of the repo's
// frontend and returns its URL.
// ponytail: synchronous like /analyze — npm install can hold the response
// open for minutes; the UI shows a spinner. Async job is the first upgrade.
func (s *Server) preview(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RepoURL string `json:"repo_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RepoURL == "" {
		httpError(w, http.StatusBadRequest, `body must be {"repo_url": "github.com/user/project"}`)
		return
	}
	url, err := preview.Start(req.RepoURL)
	if err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, map[string]string{"url": url})
}

// ask answers a question about a selected component in the live preview:
// it enriches the selection with the source snippet and the stored map,
// then forwards to the analyzer's qa task.
func (s *Server) ask(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RepoURL    string           `json:"repo_url"`
		Question   string           `json:"question"`
		Selection  map[string]any   `json:"selection"`
		Selections []map[string]any `json:"selections"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RepoURL == "" || req.Question == "" {
		httpError(w, http.StatusBadRequest, `body must be {"repo_url": "...", "question": "...", "selection": {...}}`)
		return
	}

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
	if len(sels) > 1 {
		payload["selections"] = sels
	}
	if file, _ := primary["file"].(string); file != "" {
		line := 0
		if l, ok := primary["line"].(float64); ok {
			line = int(l)
		}
		if snip := snippet(req.RepoURL, file, line); snip != "" {
			payload["file_snippet"] = snip
		}
	}
	if s.DB != "" {
		if m := storedMap(s.DB, req.RepoURL); m != nil {
			payload["map"] = m
		}
	}

	data, err := graph.RunTask("qa", payload)
	if err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// files browses the running preview's checkout: a directory listing, or the
// contents of one file. Paths are relative to the frontend dir (web/src and
// friends), which is what the theater's Files tab shows.
// ponytail: reads straight off disk on every request — the checkout is local
// and small enough; cache when a listing is measurably slow.
func (s *Server) files(w http.ResponseWriter, r *http.Request) {
	repoURL := r.URL.Query().Get("repo_url")
	if repoURL == "" {
		httpError(w, http.StatusBadRequest, "repo_url is required")
		return
	}
	_, appDir, ok := preview.Lookup(repoURL)
	if !ok {
		// Not an error: the preview boots on first open and the tab may be
		// ahead of it. The UI shows the same "starting…" state as the iframe.
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
		// 512KB: enough for any source file, small enough that a stray click
		// on a bundled asset can't stall the panel.
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
	for _, e := range entries {
		name := e.Name()
		// Noise that makes the tree unusable, not a security boundary.
		if name == ".git" || name == "node_modules" || strings.HasPrefix(name, ".") {
			continue
		}
		out = append(out, entry{Name: name, Path: path.Join(rel, name), Dir: e.IsDir()})
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

// safeJoin resolves a client-supplied path under base and refuses anything
// that escapes it — `path` crosses a trust boundary, symlinks included.
func safeJoin(base, rel string) (full, clean string, err error) {
	// Rooting at "/" before Clean is what kills the traversal: the result can
	// never contain "..", however many the client sent.
	clean = path.Clean("/" + strings.TrimPrefix(rel, "/"))[1:]
	realBase, err := filepath.EvalSymlinks(base)
	if err != nil {
		return "", "", fmt.Errorf("preview checkout unavailable")
	}
	full = filepath.Join(realBase, filepath.FromSlash(clean))
	// A symlink *inside* the checkout can still point anywhere, and the
	// textual join above would not notice. Only resolvable paths are checked;
	// missing ones are the caller's Stat to reject.
	if realFull, err := filepath.EvalSymlinks(full); err == nil {
		r, err := filepath.Rel(realBase, realFull)
		if err != nil || r == ".." || strings.HasPrefix(r, ".."+string(filepath.Separator)) {
			return "", "", fmt.Errorf("path escapes the repository")
		}
	}
	return full, clean, nil
}

// snippet reads ~150 lines of the selected file, centered on line, from the
// preview's checkout. The fiber gives a frontend-relative path (src/...), so
// try it under the frontend dir first, then the repo root.
//
// Workspace questions have no preview running, so fall back to a checkout the
// server already cloned for an earlier preview — reading it only if it is
// already on disk.
// ponytail: no clone on demand; that's minutes of synchronous wait inside
// /ask. Upgrade path is an async fetch job, not a blocking clone here.
func snippet(repoURL, file string, line int) string {
	if strings.Contains(file, "..") {
		return ""
	}
	root, appDir, ok := preview.Lookup(repoURL)
	if !ok {
		dir, err := scan.CheckoutDir(repoURL)
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

// storedMap finds the saved analysis for repoURL, or nil.
func storedMap(dbPath, repoURL string) *graph.Map {
	norm, _, err := scan.NormalizeURL(repoURL)
	if err != nil {
		return nil
	}
	list, err := store.List(dbPath)
	if err != nil {
		return nil
	}
	for _, s := range list {
		got, _, err := scan.NormalizeURL(s.RepoURL)
		if err != nil || got != norm {
			continue
		}
		m, err := store.Get(dbPath, s.ID)
		if err != nil {
			return nil
		}
		return m
	}
	return nil
}

func (s *Server) list(w http.ResponseWriter, r *http.Request) {
	list, err := store.List(s.DB)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, list)
}

func (s *Server) get(w http.ResponseWriter, r *http.Request) {
	var id int64
	if _, err := fmt.Sscan(r.PathValue("id"), &id); err != nil {
		httpError(w, http.StatusBadRequest, "id must be a number")
		return
	}
	m, err := store.Get(s.DB, id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if m == nil {
		httpError(w, http.StatusNotFound, fmt.Sprintf("no analysis with id %d", id))
		return
	}
	writeJSON(w, m)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func httpError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
