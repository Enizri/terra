// Package server is Terra's HTTP API (analyze, jobs, preview, traces, store).
package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
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
	// StaticDir, when set, serves the built web UI (SPA) for non-API GET paths.
	StaticDir string
	// Preview boots live previews; nil uses preview.Default() (host unless TERRA_PREVIEW_MODE).
	Preview preview.Runner
	// Jobs is nil until Handler creates a hub.
	Jobs *job.Hub
	// Optional stubs for tests; nil uses production implementations.
	Scan    func(url string) (*scan.Result, error)
	Analyze func(ctx context.Context, res *scan.Result, model string) (*graph.Map, []string, error)
	RunTask func(ctx context.Context, name string, payload any) (json.RawMessage, error)

	// analyzeSlots caps concurrent analyze work; initialised in Handler so
	// tests picking TERRA_ANALYZE_CONCURRENCY via t.Setenv take effect.
	analyzeSlots chan struct{}

	// initOnce guards Handler's lazy field assignments: two concurrent calls
	// would otherwise race and split jobs across two hubs.
	initOnce sync.Once
}

// maxBodyBytes caps request bodies on JSON endpoints. Ask payloads carry a
// question plus selections and ingest is capped at 100 spans; 1 MiB is generous.
const maxBodyBytes = 1 << 20

func analyzeDepth() int {
	if n, err := strconv.Atoi(os.Getenv("TERRA_ANALYZE_CONCURRENCY")); err == nil && n >= 1 {
		return n
	}
	return 4
}

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

// decodeBody decodes a size-capped JSON body; on failure it writes the error
// and returns false. shape is the 400 message.
func decodeBody(w http.ResponseWriter, r *http.Request, dst any, shape string) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			httpError(w, http.StatusRequestEntityTooLarge, "request body too large")
			return false
		}
		httpError(w, http.StatusBadRequest, shape)
		return false
	}
	return true
}

// analyzeTimeout is the wall-clock cap for one analyze job
// (TERRA_ANALYZE_TIMEOUT, default 15m; bad values fall back).
func analyzeTimeout() time.Duration {
	if d, err := time.ParseDuration(os.Getenv("TERRA_ANALYZE_TIMEOUT")); err == nil && d > 0 {
		return d
	}
	return 15 * time.Minute
}

// stopLabel distinguishes a user cancel from the deadline. The exact string
// "cancelled" is load-bearing: the web client treats it as a silent abort.
func stopLabel(ctx context.Context) string {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return fmt.Sprintf("analyze exceeded the %s limit (raise TERRA_ANALYZE_TIMEOUT)", analyzeTimeout())
	}
	return "cancelled"
}

func (s *Server) previewRunner() preview.Runner {
	if s.Preview != nil {
		return s.Preview
	}
	return preview.Default()
}

func (s *Server) Handler() http.Handler {
	s.initOnce.Do(func() {
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
		if s.analyzeSlots == nil {
			s.analyzeSlots = make(chan struct{}, analyzeDepth())
		}
	})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.root)
	mux.HandleFunc("GET /healthz", s.healthz)
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
	if s.StaticDir != "" {
		mux.HandleFunc("GET /{path...}", s.static)
	}
	// Limiter outermost: unauthenticated floods are rejected before token work.
	gated := withRateLimit(withToken(mux))
	// Path-based live previews (Compose iframes). Outside the mux so it does not
	// conflict with GET /{path...}; left open — starting a preview is gated at POST /preview.
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/__live/") {
			preview.LiveHandler().ServeHTTP(w, r)
			return
		}
		gated.ServeHTTP(w, r)
	})
}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{"service": "terra", "status": "ok"})
}

// root serves the SPA index when StaticDir is set; otherwise redirects to
// TERRA_WEB_URL (make dev) or returns a small JSON liveness payload.
func (s *Server) root(w http.ResponseWriter, r *http.Request) {
	if s.StaticDir != "" {
		http.ServeFile(w, r, filepath.Join(s.StaticDir, "index.html"))
		return
	}
	if u := strings.TrimSpace(os.Getenv("TERRA_WEB_URL")); u != "" {
		http.Redirect(w, r, u, http.StatusFound)
		return
	}
	writeJSON(w, map[string]string{"service": "terra", "status": "ok"})
}

// ListenAndServe starts the HTTP server and blocks.
func (s *Server) ListenAndServe(addr string) error {
	fmt.Fprintf(os.Stderr, "terra API listening on %s\n", addr)
	token := "set"
	if strings.TrimSpace(os.Getenv("TERRA_TOKEN")) == "" {
		token = "OPEN"
	}
	rateLimit := "off"
	if l := newIPLimiter(); l != nil {
		rateLimit = fmt.Sprintf("%g/s", float64(l.rps))
	}
	fmt.Fprintf(os.Stderr, "terra: token=%s rate=%s analyze-depth=%d analyze-timeout=%s\n",
		token, rateLimit, analyzeDepth(), analyzeTimeout())
	return (&http.Server{Addr: addr, Handler: s.Handler()}).ListenAndServe()
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

	res, err := s.Scan(req.RepoURL)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	if repoMap := s.cached(res); repoMap != nil {
		writeJSON(w, repoMap)
		return
	}
	repoMap, warnings, err := s.Analyze(r.Context(), res, req.Model)
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
	j := s.startAnalyzeJob(repoURL, model, done)
	s.streamJobEvents(w, ctx, j)
}

// enqueueAnalyze starts an analyze job and returns its id.
func (s *Server) enqueueAnalyze(w http.ResponseWriter, r *http.Request) {
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
	if _, _, err := scan.NormalizeURL(req.RepoURL); err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Claim the slot before returning the job id: once the id is out, a
	// failure can only surface as an event, never a 429.
	if !s.acquireAnalyze() {
		s.analyzeBusy(w)
		return
	}
	j := s.startAnalyzeJob(req.RepoURL, req.Model, s.releaseAnalyze)
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

func (s *Server) startAnalyzeJob(repoURL, model string, done func()) *job.Job {
	return s.Jobs.Start(func(jobCtx context.Context, emit func(job.Event)) {
		defer done() // release the analyze slot on every exit, panic included
		ctx, cancel := context.WithTimeout(jobCtx, analyzeTimeout())
		defer cancel()
		emit(job.Event{Stage: "clone", Label: "Cloning " + repoURL})
		if err := ctx.Err(); err != nil {
			emit(job.Event{Stage: "error", Label: stopLabel(ctx)})
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
			emit(job.Event{Stage: "error", Label: stopLabel(ctx)})
			return
		}
		emit(job.Event{Stage: "analyze", Label: "Terra is reading the architecture"})
		repoMap, warnings, err := s.Analyze(ctx, res, model)
		if err != nil {
			if ctx.Err() != nil {
				emit(job.Event{Stage: "error", Label: stopLabel(ctx)})
				return
			}
			emit(job.Event{Stage: "error", Label: err.Error()})
			return
		}
		for _, warn := range warnings {
			fmt.Fprintln(os.Stderr, "warning:", warn)
		}
		if err := ctx.Err(); err != nil {
			emit(job.Event{Stage: "error", Label: stopLabel(ctx)})
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

// preview starts or reuses a live frontend preview and returns its URL.
func (s *Server) preview(w http.ResponseWriter, r *http.Request) {
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
	url, err := s.previewRunner().Start(req.RepoURL)
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

// ask answers synchronously; prefer POST /jobs/ask for the web client.
func (s *Server) ask(w http.ResponseWriter, r *http.Request) {
	req, ok := decodeAsk(w, r)
	if !ok {
		return
	}
	data, err := s.RunTask(r.Context(), "qa", s.askPayload(req))
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
		data, err := s.RunTask(ctx, "qa", payload)
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
	if !decodeBody(w, r, &req, `body must be {"repo_url": "...", "question": "...", "selection": {...}}`) {
		return req, false
	}
	if req.RepoURL == "" || req.Question == "" {
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
		if snip := snippet(s.previewRunner(), req.RepoURL, file, line); snip != "" {
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

// traces streams request spans for a repo as SSE (history, then live).
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
	// Flush a comment so EventSource opens on a quiet stream.
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

// snippet returns ~150 lines centered on line from an existing checkout.
func snippet(r preview.Runner, repoURL, file string, line int) string {
	if strings.Contains(file, "..") {
		return ""
	}
	root, appDir, ok := r.Lookup(repoURL)
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

// cached returns the stored map when HEAD matches the last analysis commit.
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

// storedMap returns the saved analysis for repoURL, or nil.
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
