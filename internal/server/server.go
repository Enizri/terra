// Package server exposes Terra over HTTP: analyze a repository, list past
// analyses, fetch one. Long analyze work runs as a process-local job so the
// browser can detach; sync POST /analyze remains for the CLI.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/Enizri/terra/internal/graph"
	"github.com/Enizri/terra/internal/job"
	"github.com/Enizri/terra/internal/preview"
	"github.com/Enizri/terra/internal/scan"
	"github.com/Enizri/terra/internal/store"
	"github.com/Enizri/terra/internal/trace"
)

type Server struct {
	DB string
	// Jobs holds in-flight analyze work. Nil means a fresh hub on first use.
	Jobs *job.Hub
	// Scan, Analyze, and RunTask exist so tests can stub I/O; zero values
	// mean the real thing.
	Scan    func(url string) (*scan.Result, error)
	Analyze func(res *scan.Result, model string) (*graph.Map, []string, error)
	RunTask func(name string, payload any) (json.RawMessage, error)
}

func (s *Server) Handler() http.Handler {
	if s.Scan == nil {
		s.Scan = scan.Scan
	}
	if s.Analyze == nil {
		s.Analyze = graph.Analyze
	}
	if s.RunTask == nil {
		s.RunTask = graph.RunTask
	}
	if s.Jobs == nil {
		s.Jobs = job.NewHub()
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /analyze", s.analyze)
	mux.HandleFunc("POST /jobs/analyze", s.enqueueAnalyze)
	mux.HandleFunc("POST /jobs/ask", s.enqueueAsk)
	mux.HandleFunc("GET /jobs/{id}/events", s.jobEvents)
	mux.HandleFunc("POST /jobs/{id}/cancel", s.cancelJob)
	mux.HandleFunc("GET /analyses", s.list)
	mux.HandleFunc("GET /analyses/{id}", s.get)
	mux.HandleFunc("POST /preview", s.preview)
	mux.HandleFunc("POST /ask", s.ask)
	mux.HandleFunc("GET /files", s.files)
	mux.HandleFunc("GET /traces", s.traces)
	mux.HandleFunc("POST /traces/ingest", s.ingest)
	return mux
}

// ListenAndServe blocks. Sync analyze/ask may still hold a connection for
// minutes; the job endpoints do not.
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
		s.analyzeStream(w, r.Context(), req.RepoURL, req.Model)
		return
	}

	res, err := s.Scan(req.RepoURL)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	if repoMap := s.cached(res); repoMap != nil {
		writeJSON(w, repoMap)
		return
	}
	repoMap, warnings, err := s.Analyze(res, req.Model)
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

// analyzeStream starts the pipeline as a job and streams its events on this
// response — same NDJSON shape as before, but Analyze runs off the handler
// goroutine.
func (s *Server) analyzeStream(w http.ResponseWriter, ctx context.Context, repoURL, model string) {
	j := s.startAnalyzeJob(repoURL, model)
	s.streamJobEvents(w, ctx, j)
}

// enqueueAnalyze starts an analyze job and returns its id immediately so the
// client can subscribe on GET /jobs/{id}/events without holding this request
// open for the LLM.
func (s *Server) enqueueAnalyze(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RepoURL string `json:"repo_url"`
		Model   string `json:"model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RepoURL == "" {
		httpError(w, http.StatusBadRequest, `body must be {"repo_url": "github.com/user/project"}`)
		return
	}
	if _, _, err := scan.NormalizeURL(req.RepoURL); err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	j := s.startAnalyzeJob(req.RepoURL, req.Model)
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

func (s *Server) startAnalyzeJob(repoURL, model string) *job.Job {
	return s.Jobs.Start(func(ctx context.Context, emit func(job.Event)) {
		emit(job.Event{Stage: "clone", Label: "Cloning " + repoURL})
		if err := ctx.Err(); err != nil {
			emit(job.Event{Stage: "error", Label: "cancelled"})
			return
		}
		res, err := s.Scan(repoURL)
		if err != nil {
			emit(job.Event{Stage: "error", Label: err.Error()})
			return
		}
		emit(job.Event{
			Stage: "scan",
			Label: fmt.Sprintf("Read %d files across %d languages",
				res.Stats.SourceFiles, len(res.Languages)),
		})
		if repoMap := s.cached(res); repoMap != nil {
			emit(job.Event{Stage: "done", Map: repoMap})
			return
		}
		if err := ctx.Err(); err != nil {
			emit(job.Event{Stage: "error", Label: "cancelled"})
			return
		}
		emit(job.Event{Stage: "analyze", Label: "Terra is reading the architecture"})
		repoMap, warnings, err := s.Analyze(res, model)
		if err != nil {
			emit(job.Event{Stage: "error", Label: err.Error()})
			return
		}
		for _, warn := range warnings {
			fmt.Fprintln(os.Stderr, "warning:", warn)
		}
		if err := ctx.Err(); err != nil {
			emit(job.Event{Stage: "error", Label: "cancelled"})
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

// streamJobEvents writes job events as NDJSON until the job finishes or the
// client goes away. History replays first so a late subscriber is complete.
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

type askRequest struct {
	RepoURL    string           `json:"repo_url"`
	Question   string           `json:"question"`
	Selection  map[string]any   `json:"selection"`
	Selections []map[string]any `json:"selections"`
}

// ask answers synchronously (CLI / older clients). Prefer POST /jobs/ask.
func (s *Server) ask(w http.ResponseWriter, r *http.Request) {
	req, ok := decodeAsk(w, r)
	if !ok {
		return
	}
	data, err := s.RunTask("qa", s.askPayload(req))
	if err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// enqueueAsk starts a qa job and returns its id immediately.
func (s *Server) enqueueAsk(w http.ResponseWriter, r *http.Request) {
	req, ok := decodeAsk(w, r)
	if !ok {
		return
	}
	payload := s.askPayload(req)
	j := s.Jobs.Start(func(ctx context.Context, emit func(job.Event)) {
		emit(job.Event{Stage: "ask", Label: "Terra is reading the selection"})
		if err := ctx.Err(); err != nil {
			emit(job.Event{Stage: "error", Label: "cancelled"})
			return
		}
		data, err := s.RunTask("qa", payload)
		if err != nil {
			emit(job.Event{Stage: "error", Label: err.Error()})
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

func decodeAsk(w http.ResponseWriter, r *http.Request) (askRequest, bool) {
	var req askRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RepoURL == "" || req.Question == "" {
		httpError(w, http.StatusBadRequest, `body must be {"repo_url": "...", "question": "...", "selection": {...}}`)
		return req, false
	}
	return req, true
}

func (s *Server) askPayload(req askRequest) map[string]any {
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
		if repoMap := storedMap(s.DB, req.RepoURL); repoMap != nil {
			payload["map"] = repoMap
		}
	}
	return payload
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
	for _, ent := range entries {
		name := ent.Name()
		// Noise that makes the tree unusable, not a security boundary.
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

// traces streams the live preview's request spans for one repo as
// Server-Sent Events: ring-buffer history first, then live spans until the
// client goes away. SSE over WebSocket on purpose — fan-out is one-way and
// the stdlib does it in a handler.
func (s *Server) traces(w http.ResponseWriter, r *http.Request) {
	repoURL := r.URL.Query().Get("repo_url")
	key, _, err := scan.NormalizeURL(repoURL)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	// SSE comment as an immediate hello: without a first flush the headers sit
	// in the buffer and EventSource never fires `open` on a quiet stream.
	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	send := func(span trace.Span) {
		data, _ := json.Marshal(span)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}
	history, ch, cancel := trace.Subscribe(key)
	defer cancel()
	for _, span := range history {
		send(span)
	}
	for {
		select {
		case span, ok := <-ch:
			if !ok {
				return
			}
			send(span)
		case <-r.Context().Done():
			return
		}
	}
}

// ingest accepts span batches from the trace hook running inside a previewed
// app's Node processes and publishes them on the same hub the edge proxy
// uses, so the map animates the request's whole path. Repo and Time are
// stamped server-side — the hook is inside untrusted app code and gets to
// say what happened, not when or for whom.
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RepoURL == "" {
		httpError(w, http.StatusBadRequest, `body must be {"repo_url": "...", "spans": [...]}`)
		return
	}
	key, _, err := scan.NormalizeURL(req.RepoURL)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Cap, don't reject: a misbehaving hook loses spans, not the stream.
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
		relPath, err := filepath.Rel(realBase, realFull)
		if err != nil || relPath == ".." || strings.HasPrefix(relPath, ".."+string(filepath.Separator)) {
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

// cached returns the stored map when the repo's HEAD commit hasn't moved
// since the last analysis. Everything is keyed by the commit SHA the scan
// resolved, so a repeat visitor to an unchanged repo never pays the analyzer.
func (s *Server) cached(res *scan.Result) *graph.Map {
	if s.DB == "" || res.Commit == "" {
		return nil
	}
	commit, repoMap, err := store.Find(s.DB, res.RepositoryURL)
	if err != nil || commit != res.Commit {
		return nil
	}
	return repoMap
}

// storedMap finds the saved analysis for repoURL, or nil.
func storedMap(dbPath, repoURL string) *graph.Map {
	norm, _, err := scan.NormalizeURL(repoURL)
	if err != nil {
		return nil
	}
	_, repoMap, err := store.Find(dbPath, norm)
	if err != nil {
		return nil
	}
	return repoMap
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
	repoMap, err := store.Get(s.DB, id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if repoMap == nil {
		httpError(w, http.StatusNotFound, fmt.Sprintf("no analysis with id %d", id))
		return
	}
	writeJSON(w, repoMap)
}

func writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(payload)
}

func httpError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
