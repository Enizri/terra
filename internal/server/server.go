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
	"strings"
	"sync"
	"time"

	"github.com/Enizri/terra/internal/catalog"
	"github.com/Enizri/terra/internal/config"
	"github.com/Enizri/terra/internal/graph"
	"github.com/Enizri/terra/internal/job"
	"github.com/Enizri/terra/internal/llmlocal"
	"github.com/Enizri/terra/internal/preview"
	"github.com/Enizri/terra/internal/recommend"
	"github.com/Enizri/terra/internal/scan"
	"github.com/Enizri/terra/internal/store"
	"github.com/Enizri/terra/internal/trace"
)

type Server struct {
	DB string
	// StaticDir, when set, serves the built web UI (SPA) for non-API GET paths.
	StaticDir string
	// Cfg holds the parsed TERRA_* settings; nil makes Handler call
	// config.FromEnv() (so tests using t.Setenv keep working).
	Cfg *config.Config
	// Preview boots live previews; nil uses preview.Default(Cfg).
	Preview preview.Runner
	// Jobs is nil until Handler creates a hub.
	Jobs *job.Hub
	// Optional stubs for tests; nil uses production implementations.
	// commit is the already-resolved HEAD SHA; empty means Scan must resolve it.
	Scan func(url, commit string) (*scan.Result, error)
	// Resolve returns canonical URL, short name, and HEAD SHA without a tarball.
	Resolve func(url string) (canonical, name, commit string, err error)
	Analyze func(ctx context.Context, res *scan.Result, opts graph.LLMOpts) (*graph.Map, []string, error)
	RunTask func(ctx context.Context, name string, payload any) (json.RawMessage, error)

	// Host reports what this machine can run locally; nil detects it once.
	Host func() catalog.Capabilities

	// RepoMeta reads cheap GitHub metadata for the provisional recommendation;
	// nil uses scan.RepoMeta. Failure is never fatal to a probe.
	RepoMeta func(url string) (language string, sizeKB int64, err error)

	// EnsureModel makes the local sidecar serve hfID before analyze runs,
	// emitting ensure_model progress. nil skips the step entirely.
	EnsureModel func(ctx context.Context, hfID string, emit func(job.Event)) error

	// analyzeSlots caps concurrent analyze work (Cfg.AnalyzeConcurrency).
	analyzeSlots chan struct{}

	// probes caches probe scans for the analyze that follows the model gate.
	probeMu sync.Mutex
	probes  map[string]probeEntry

	// initOnce guards Handler's lazy field assignments: two concurrent calls
	// would otherwise race and split jobs across two hubs.
	initOnce sync.Once
}

// maxBodyBytes caps request bodies on JSON endpoints. Ask payloads carry a
// question plus selections and ingest is capped at 100 spans; 1 MiB is generous.
const maxBodyBytes = 1 << 20

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

// stopLabel distinguishes a user cancel from the deadline. The exact string
// "cancelled" is load-bearing: the web client treats it as a silent abort.
func stopLabel(ctx context.Context, timeout time.Duration) string {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return fmt.Sprintf("analyze exceeded the %s limit (raise TERRA_ANALYZE_TIMEOUT)", timeout)
	}
	return "cancelled"
}

func (s *Server) previewRunner() preview.Runner {
	if s.Preview != nil {
		return s.Preview
	}
	return preview.Default(s.Cfg)
}

func (s *Server) Handler() http.Handler {
	s.initOnce.Do(func() {
		if s.Cfg == nil {
			s.Cfg = config.FromEnv()
		}
		if s.Scan == nil {
			s.Scan = func(url, commit string) (*scan.Result, error) {
				if commit != "" {
					return scan.ScanAt(url, commit)
				}
				return scan.Scan(url)
			}
		}
		if s.Resolve == nil {
			s.Resolve = scan.ResolveHead
		}
		if s.Analyze == nil {
			s.Analyze = func(ctx context.Context, res *scan.Result, opts graph.LLMOpts) (*graph.Map, []string, error) {
				return graph.Analyze(ctx, s.Cfg.AnalyzerURL, res, opts)
			}
		}
		if s.Host == nil {
			// Detected once per process: it shells out to sysctl/nvidia-smi
			// and the answer cannot change while the server runs.
			s.Host = sync.OnceValue(catalog.DetectHost)
		}
		if s.RepoMeta == nil {
			s.RepoMeta = scan.RepoMeta
		}
		if s.EnsureModel == nil {
			s.EnsureModel = func(ctx context.Context, hfID string, emit func(job.Event)) error {
				return llmlocal.EnsureModel(ctx, s.Cfg.LocalLLMURL, hfID, emit)
			}
		}
		if s.RunTask == nil {
			s.RunTask = func(ctx context.Context, name string, payload any) (json.RawMessage, error) {
				return graph.RunTask(ctx, s.Cfg.AnalyzerURL, name, payload)
			}
		}
		if s.Jobs == nil {
			s.Jobs = job.NewHub()
		}
		if s.analyzeSlots == nil {
			s.analyzeSlots = make(chan struct{}, s.Cfg.AnalyzeConcurrency)
		}
	})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.root)
	mux.HandleFunc("GET /healthz", s.healthz)
	mux.HandleFunc("GET /models", s.models)
	mux.HandleFunc("GET /host/capabilities", s.hostCapabilities)
	mux.HandleFunc("POST /analyze", s.analyze)
	mux.HandleFunc("POST /jobs/probe", s.enqueueProbe)
	mux.HandleFunc("POST /jobs/analyze", s.enqueueAnalyze)
	mux.HandleFunc("POST /jobs/ask", s.enqueueAsk)
	mux.HandleFunc("GET /jobs/{id}/events", s.jobEvents)
	mux.HandleFunc("POST /jobs/{id}/cancel", s.cancelJob)
	mux.HandleFunc("GET /analyses", s.list)
	mux.HandleFunc("GET /analyses/{id}", s.get)
	mux.HandleFunc("DELETE /analyses/{id}", s.deleteAnalysis)
	mux.HandleFunc("POST /preview", s.preview)
	mux.HandleFunc("POST /ask", s.ask)
	mux.HandleFunc("GET /files", s.files)
	mux.HandleFunc("GET /traces", s.traces)
	mux.HandleFunc("POST /traces/ingest", s.ingest)
	if s.StaticDir != "" {
		mux.HandleFunc("GET /{path...}", s.static)
	}
	// Limiter outermost: unauthenticated floods are rejected before token work.
	gated := withRateLimit(s.Cfg.RateLimit, withToken(s.Cfg.Token, mux))
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

// models returns the static model catalog. Left ungated (see requiresToken):
// it is a constant shipped with the binary, same risk class as /healthz.
func (s *Server) models(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"models": catalog.All()})
}

func (s *Server) hostCapabilities(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.Host())
}

// root serves the SPA index when StaticDir is set; otherwise redirects to
// TERRA_WEB_URL (make dev) or returns a small JSON liveness payload.
func (s *Server) root(w http.ResponseWriter, r *http.Request) {
	if s.StaticDir != "" {
		http.ServeFile(w, r, filepath.Join(s.StaticDir, "index.html"))
		return
	}
	if s.Cfg.WebURL != "" {
		http.Redirect(w, r, s.Cfg.WebURL, http.StatusFound)
		return
	}
	writeJSON(w, map[string]string{"service": "terra", "status": "ok"})
}

// ListenAndServe starts the HTTP server and blocks.
func (s *Server) ListenAndServe(addr string) error {
	handler := s.Handler() // also fills in s.Cfg
	fmt.Fprintf(os.Stderr, "terra API listening on %s\n", addr)
	token := "set"
	if s.Cfg.Token == "" {
		token = "OPEN"
	}
	rateLimit := "off"
	if l := newIPLimiter(s.Cfg.RateLimit); l != nil {
		rateLimit = fmt.Sprintf("%g/s", float64(l.rps))
	}
	fmt.Fprintf(os.Stderr, "terra: token=%s rate=%s analyze-depth=%d analyze-timeout=%s\n",
		token, rateLimit, s.Cfg.AnalyzeConcurrency, s.Cfg.AnalyzeTimeout)
	return (&http.Server{Addr: addr, Handler: handler}).ListenAndServe()
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
	repoMap, warnings, err := s.Analyze(r.Context(), res, graph.LLMOpts{Model: req.Model})
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
		sel:     modelSelection{Opts: graph.LLMOpts{Model: model}},
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

// selectModel validates the picker fields and resolves them. fallbackModel is
// the legacy free-form override, honoured only when nothing was picked. It
// writes the 400 itself and reports ok=false when the request cannot run.
func (s *Server) selectModel(w http.ResponseWriter, modelID, apiKey, fallbackModel string) (modelSelection, bool) {
	if modelID == "" {
		// No pick: legacy/operator behaviour, TERRA_LLM_* decides.
		return modelSelection{Opts: graph.LLMOpts{Model: fallbackModel}}, true
	}
	entry := catalog.Find(modelID)
	if entry == nil {
		httpError(w, http.StatusBadRequest, fmt.Sprintf("unknown model_id %q", modelID))
		return modelSelection{}, false
	}
	if entry.RequiresAPIKey && strings.TrimSpace(apiKey) == "" {
		httpError(w, http.StatusBadRequest,
			fmt.Sprintf("%s needs a %s API key", entry.DisplayName, entry.Provider))
		return modelSelection{}, false
	}
	// Same rule the ModelGate renders: a local model that will OOM or crawl
	// on this host must not start ensure_model just because the client
	// bypassed the disabled button.
	if ok, hint := recommend.Eligible(*entry, catalog.DetectHost()); !ok {
		httpError(w, http.StatusBadRequest,
			fmt.Sprintf("%s cannot run here: %s", entry.DisplayName, hint))
		return modelSelection{}, false
	}
	return resolveModel(s.Cfg, entry, strings.TrimSpace(apiKey)), true
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
			Map: graph.FromScan(res),
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

// cached returns the stored map when HEAD matches the last analysis commit.
func (s *Server) cached(res *scan.Result) *graph.Map {
	return s.cachedAt(res.RepositoryURL, res.Commit)
}

// cachedAt returns the stored map when repoURL's saved commit equals commit.
func (s *Server) cachedAt(repoURL, commit string) *graph.Map {
	if s.DB == "" || repoURL == "" || commit == "" {
		return nil
	}
	stored, repoMap, err := store.Find(s.DB, repoURL)
	if err != nil || stored != commit {
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

func (s *Server) deleteAnalysis(w http.ResponseWriter, r *http.Request) {
	var id int64
	if _, err := fmt.Sscan(r.PathValue("id"), &id); err != nil {
		httpError(w, http.StatusBadRequest, "id must be a number")
		return
	}
	ok, err := store.Delete(s.DB, id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusNotFound, fmt.Sprintf("no analysis with id %d", id))
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
