// Package server is Terra's HTTP API (analyze, jobs, preview, traces, store).
package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Enizri/terra/backend/api/internal/analysis"
	analyzepipeline "github.com/Enizri/terra/backend/api/internal/analyze"
	"github.com/Enizri/terra/backend/api/internal/analyzerclient"
	"github.com/Enizri/terra/backend/api/internal/catalog"
	"github.com/Enizri/terra/backend/api/internal/config"
	"github.com/Enizri/terra/backend/api/internal/job"
	"github.com/Enizri/terra/backend/api/internal/llmlocal"
	"github.com/Enizri/terra/backend/api/internal/preview"
	"github.com/Enizri/terra/backend/api/internal/recommend"
	"github.com/Enizri/terra/backend/api/internal/scan"
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
	Analyze func(ctx context.Context, res *scan.Result, opts analyzerclient.LLMOpts) (*analysis.Map, []string, error)
	RunTask func(ctx context.Context, name string, payload any) (json.RawMessage, error)
	// StreamTask reads NDJSON from a streaming analyzer task and forwards
	// {stage,label} events. The returned string is the final answer.
	StreamTask func(ctx context.Context, name string, payload any, emit func(job.Event)) (string, error)

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

	// Probes caches scan-only probe results for the analyze after model selection.
	Probes *analyzepipeline.ProbeCache

	// initOnce guards Handler's lazy field assignments: two concurrent calls
	// would otherwise race and split jobs across two hubs.
	initOnce sync.Once
}

// maxBodyBytes caps request bodies on JSON endpoints. Ask payloads carry a
// question plus selections and ingest is capped at 100 spans; 1 MiB is generous.
const maxBodyBytes = 1 << 20

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
			s.Analyze = func(ctx context.Context, res *scan.Result, opts analyzerclient.LLMOpts) (*analysis.Map, []string, error) {
				return analyzerclient.Analyze(ctx, s.Cfg.AnalyzerURL, res, opts)
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
				return analyzerclient.RunTask(ctx, s.Cfg.AnalyzerURL, name, payload)
			}
		}
		if s.StreamTask == nil {
			s.StreamTask = func(ctx context.Context, name string, payload any, emit func(job.Event)) (string, error) {
				return analyzerclient.StreamTask(ctx, s.Cfg.AnalyzerURL, name, payload, func(ev analyzerclient.TaskEvent) {
					if ev.Stage == "" {
						return
					}
					emit(job.Event{Stage: ev.Stage, Label: ev.Label})
				})
			}
		}
		if s.Jobs == nil {
			s.Jobs = job.NewHub()
		}
		if s.analyzeSlots == nil {
			s.analyzeSlots = make(chan struct{}, s.Cfg.AnalyzeConcurrency)
		}
		if s.Probes == nil {
			s.Probes = analyzepipeline.NewProbeCache(analyzepipeline.ProbeTTL)
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
	mux.HandleFunc("POST /jobs/agent", s.enqueueAgent)
	mux.HandleFunc("POST /jobs/preview", s.enqueuePreview)
	mux.HandleFunc("GET /jobs/{id}/events", s.jobEvents)
	mux.HandleFunc("POST /jobs/{id}/cancel", s.cancelJob)
	mux.HandleFunc("GET /analyses", s.list)
	mux.HandleFunc("GET /analyses/{id}", s.get)
	mux.HandleFunc("DELETE /analyses/{id}", s.deleteAnalysis)
	mux.HandleFunc("POST /preview", s.preview)
	mux.HandleFunc("POST /preview/patch", s.previewPatch)
	mux.HandleFunc("POST /preview/restart", s.previewRestart)
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
		if s.Cfg != nil {
			grantAccessCookie(w, s.Cfg.Token)
		}
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

// selectModel validates the picker fields and resolves them. fallbackModel is
// the legacy free-form override, honoured only when nothing was picked. It
// writes the 400 itself and reports ok=false when the request cannot run.
func (s *Server) selectModel(w http.ResponseWriter, modelID, apiKey, fallbackModel string) (modelSelection, bool) {
	if modelID == "" {
		// No pick: legacy/operator behaviour, TERRA_LLM_* decides.
		return modelSelection{Opts: analyzerclient.LLMOpts{Model: fallbackModel}}, true
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
	res, err := s.previewRunner().Boot(req.RepoURL, nil)
	if err != nil {
		httpError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, res)
}

func (s *Server) previewPatch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RepoURL     string `json:"repo_url"`
		Path        string `json:"path"`
		UnifiedDiff string `json:"unified_diff"`
	}
	if !decodeBody(w, r, &req, `body must be {"repo_url": "...", "path": "...", "unified_diff": "..."}`) {
		return
	}
	if req.RepoURL == "" || strings.TrimSpace(req.Path) == "" {
		httpError(w, http.StatusBadRequest, `body must be {"repo_url": "...", "path": "...", "unified_diff": "..."}`)
		return
	}
	if err := s.previewRunner().ApplyPatch(req.RepoURL, req.Path, req.UnifiedDiff); err != nil {
		previewWriteError(w, err)
		return
	}
	writeJSON(w, map[string]any{"path": req.Path, "ok": true})
}

func (s *Server) previewRestart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RepoURL string `json:"repo_url"`
	}
	if !decodeBody(w, r, &req, `body must be {"repo_url": "..."}`) {
		return
	}
	if req.RepoURL == "" {
		httpError(w, http.StatusBadRequest, `body must be {"repo_url": "..."}`)
		return
	}
	if err := s.previewRunner().Restart(req.RepoURL); err != nil {
		previewWriteError(w, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func previewWriteError(w http.ResponseWriter, err error) {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "not ready"):
		httpError(w, http.StatusConflict, msg)
	case strings.Contains(msg, "too large"):
		httpError(w, http.StatusRequestEntityTooLarge, msg)
	case strings.Contains(msg, "escapes"),
		strings.Contains(msg, "required"),
		strings.Contains(msg, "does not apply"),
		strings.Contains(msg, "no hunks"),
		strings.Contains(msg, "directory"),
		strings.Contains(msg, "malformed"):
		httpError(w, http.StatusBadRequest, msg)
	default:
		httpError(w, http.StatusBadGateway, msg)
	}
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
