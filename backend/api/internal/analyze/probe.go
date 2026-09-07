package analyze

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"time"

	"github.com/Enizri/terra/backend/api/internal/analysis"
	"github.com/Enizri/terra/backend/api/internal/catalog"
	"github.com/Enizri/terra/backend/api/internal/job"
	"github.com/Enizri/terra/backend/api/internal/recommend"
)

// metaGrace is how long the probe will wait for GitHub repo metadata after
// the tarball scan has already finished. The metadata only feeds a first-guess
// recommendation the scan is about to replace, so it is worth a moment and
// never worth a stall.
const metaGrace = 300 * time.Millisecond

type RepoMetaFunc func(url string) (language string, sizeKB int64, err error)

// ProbeRunner runs fetch, scan, and model recommendation without an LLM call.
type ProbeRunner struct {
	Resolve  ResolveFunc
	Scan     ScanFunc
	RepoMeta RepoMetaFunc
	Host     func() catalog.Capabilities
	DB       string
	Cache    *ProbeCache
}

func (r *ProbeRunner) Run(ctx context.Context, repoURL string, emit func(job.Event)) error {
	clock := newClock()
	probeID := newProbeID()
	send := func(ev job.Event) {
		ev.ElapsedMS = clock.elapsed().Milliseconds()
		emit(ev)
	}
	send(job.Event{Stage: "fetch", Label: "Fetching " + repoURL})

	canonical, _, sha, err := r.Resolve(repoURL)
	clock.stop("resolve")
	if err != nil {
		log.Printf("terra: probe %s failed at resolve: %s", repoURL, clock.summary())
		return err
	}
	// A repo already mapped at this commit needs neither a tarball nor a
	// recommendation, so the whole probe is the one resolve call above. This
	// check has to come before any other GitHub request: an unauthenticated
	// caller has ~60 REST calls an hour, and re-dropping a repo you already
	// mapped must not spend two of them.
	if repoMap := cachedAt(r.DB, canonical, sha); repoMap != nil {
		clock.stop("cache")
		send(job.Event{Stage: "done", Map: repoMap, Timings: clock.stages})
		log.Printf("terra: probe %s cached %s", repoURL, clock.summary())
		return nil
	}
	clock.stop("cache")

	// Repo metadata only feeds the first-guess recommendation, which the scan
	// supersedes about half a second later. It runs beside the tarball rather
	// than before it so it costs no wall clock, and a slow or rate-limited
	// answer is simply dropped instead of delaying the map.
	type meta struct {
		language string
		sizeKB   int64
		err      error
	}
	metaCh := make(chan meta, 1)
	go func() {
		language, sizeKB, err := r.RepoMeta(repoURL)
		metaCh <- meta{language, sizeKB, err}
	}()

	entries, caps := catalog.All(), r.Host()

	res, err := r.Scan(repoURL, sha)
	if err != nil {
		clock.stop("scan")
		log.Printf("terra: probe %s failed at scan: %s", repoURL, clock.summary())
		return err
	}
	clock.stop("scan")

	// The metadata call started with the tarball, so by now it has normally
	// answered. Wait a moment for a straggler rather than dropping a guess
	// that is microseconds away, but never longer: the refined recommendation
	// is one scan behind it and does not need this at all.
	select {
	case m := <-metaCh:
		if m.err == nil {
			sig := recommend.Signals{SizeKB: m.sizeKB}
			if m.language != "" {
				sig.Languages = []string{m.language}
			}
			provisional := recommend.Recommend(entries, caps, sig)
			send(job.Event{Stage: "recommend", Label: "First guess: " + provisional.ModelID, Recommendation: &provisional})
		}
	case <-time.After(metaGrace):
	}

	send(job.Event{
		Stage: "scan",
		Label: fmt.Sprintf("Read %d files across %d languages", res.Stats.SourceFiles, len(res.Languages)),
		Map:   analysis.FromScan(res),
	})
	clock.stop("provisional_map")
	if err := ctx.Err(); err != nil {
		return err
	}

	refined := recommend.Recommend(entries, caps, recommend.FromScan(res))
	r.Cache.Store(probeID, res)
	send(job.Event{
		Stage:          "done",
		ProbeID:        probeID,
		Repo:           &recommend.RepoInfo{URL: res.RepositoryURL, Commit: res.Commit, Languages: res.PrimaryLanguages},
		Recommendation: &refined,
		Timings:        clock.stages,
	})
	log.Printf("terra: probe %s %s", repoURL, clock.summary())
	return nil
}

func newProbeID() string {
	var b [8]byte
	rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
