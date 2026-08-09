package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"

	"github.com/Enizri/terra/internal/catalog"
	"github.com/Enizri/terra/internal/graph"
	"github.com/Enizri/terra/internal/job"
	"github.com/Enizri/terra/internal/recommend"
	"github.com/Enizri/terra/internal/scan"
)

// probeTTL is how long an analyze may reuse a probe's scan. Long enough for a
// user to read the recommendation and pick, short enough that the answer is
// still about the repo's current HEAD.
const probeTTL = 15 * time.Minute

// probeEntry is one cached probe result. It holds scan output only — never a
// model selection and never an API key, which arrive with the analyze request
// and die with it.
type probeEntry struct {
	res     *scan.Result
	expires time.Time
}

// storeProbe caches res under id and sweeps anything already expired. The map
// is small (one entry per pasted URL) so a lazy sweep is enough.
func (s *Server) storeProbe(id string, res *scan.Result) {
	now := time.Now()
	s.probeMu.Lock()
	defer s.probeMu.Unlock()
	if s.probes == nil {
		s.probes = map[string]probeEntry{}
	}
	for key, entry := range s.probes {
		if now.After(entry.expires) {
			delete(s.probes, key)
		}
	}
	s.probes[id] = probeEntry{res: res, expires: now.Add(probeTTL)}
}

// readProbe returns the cached scan for id, or nil when it is unknown or
// expired and the caller must rescan. It deliberately does not consume the
// entry: a failed analyze is the most likely reason a user retries, and
// re-downloading the repo to say the same thing is the wrong answer. The TTL
// and storeProbe's sweep are what free it.
func (s *Server) readProbe(id string) *scan.Result {
	s.probeMu.Lock()
	defer s.probeMu.Unlock()
	entry, ok := s.probes[id]
	if !ok || time.Now().After(entry.expires) {
		return nil
	}
	return entry.res
}

// enqueueProbe starts the cheap first half of an analyze: fetch, scan, and a
// model recommendation, with no LLM call. It takes no analyze slot — nothing
// here is expensive, and holding one across the user's decision would stall
// the queue on a dialog nobody is looking at.
func (s *Server) enqueueProbe(w http.ResponseWriter, r *http.Request) {
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
	j := s.startProbeJob(req.RepoURL)
	writeJSON(w, map[string]string{"job_id": j.ID})
}

// newProbeID is the handle analyze quotes back to reuse this probe's scan.
// The job id would do, but Hub.Start only hands it back after the worker is
// already running, so the probe mints its own.
func newProbeID() string {
	var b [8]byte
	rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func (s *Server) startProbeJob(repoURL string) *job.Job {
	probeID := newProbeID()
	timeout := s.Cfg.AnalyzeTimeout
	caps := s.Host()
	entries := catalog.All()

	return s.Jobs.Start(func(jobCtx context.Context, emit func(job.Event)) {
		ctx, cancel := context.WithTimeout(jobCtx, timeout)
		defer cancel()
		emit(job.Event{Stage: "fetch", Label: "Fetching " + repoURL})

		canonical, _, sha, err := s.Resolve(repoURL)
		if err != nil {
			emit(job.Event{Stage: "error", Label: err.Error()})
			return
		}
		// A repo we already mapped at this commit needs no model at all: hand
		// back the stored map and let the gate stay closed (no recommendation
		// on the event means the workspace paints straight through).
		if repoMap := s.cachedAt(canonical, sha); repoMap != nil {
			emit(job.Event{Stage: "done", Map: repoMap})
			return
		}

		// Provisional pick from GitHub metadata while the tarball downloads.
		// Best-effort: a rate limit here must not fail the probe.
		sig := recommend.Signals{}
		if language, sizeKB, err := s.RepoMeta(repoURL); err == nil {
			sig.SizeKB = sizeKB
			if language != "" {
				sig.Languages = []string{language}
			}
			provisional := recommend.Recommend(entries, caps, sig)
			emit(job.Event{
				Stage:          "recommend",
				Label:          "First guess: " + provisional.ModelID,
				Recommendation: &provisional,
			})
		}

		res, err := s.Scan(repoURL, sha)
		if err != nil {
			emit(job.Event{Stage: "error", Label: err.Error()})
			return
		}
		emit(job.Event{
			Stage: "scan",
			Label: fmt.Sprintf("Read %d files across %d languages",
				res.Stats.SourceFiles, len(res.Languages)),
			Map: graph.FromScan(res),
		})
		if err := ctx.Err(); err != nil {
			emit(job.Event{Stage: "error", Label: stopLabel(ctx, timeout)})
			return
		}

		refined := recommend.Recommend(entries, caps, recommend.FromScan(res))
		s.storeProbe(probeID, res)
		emit(job.Event{
			Stage:          "done",
			ProbeID:        probeID,
			Repo:           &recommend.RepoInfo{URL: res.RepositoryURL, Commit: res.Commit, Languages: res.PrimaryLanguages},
			Recommendation: &refined,
		})
	})
}
