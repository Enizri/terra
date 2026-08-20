package analyze

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/Enizri/terra/backend/api/internal/analysis"
	"github.com/Enizri/terra/backend/api/internal/catalog"
	"github.com/Enizri/terra/backend/api/internal/job"
	"github.com/Enizri/terra/backend/api/internal/recommend"
)

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
	probeID := newProbeID()
	emit(job.Event{Stage: "fetch", Label: "Fetching " + repoURL})

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

	canonical, _, sha, err := r.Resolve(repoURL)
	if err != nil {
		return err
	}
	if repoMap := cachedAt(r.DB, canonical, sha); repoMap != nil {
		emit(job.Event{Stage: "done", Map: repoMap})
		return nil
	}

	entries, caps := catalog.All(), r.Host()
	if m := <-metaCh; m.err == nil {
		sig := recommend.Signals{SizeKB: m.sizeKB}
		if m.language != "" {
			sig.Languages = []string{m.language}
		}
		provisional := recommend.Recommend(entries, caps, sig)
		emit(job.Event{Stage: "recommend", Label: "First guess: " + provisional.ModelID, Recommendation: &provisional})
	}

	res, err := r.Scan(repoURL, sha)
	if err != nil {
		return err
	}
	emit(job.Event{
		Stage: "scan",
		Label: fmt.Sprintf("Read %d files across %d languages", res.Stats.SourceFiles, len(res.Languages)),
		Map:   analysis.FromScan(res),
	})
	if err := ctx.Err(); err != nil {
		return err
	}

	refined := recommend.Recommend(entries, caps, recommend.FromScan(res))
	r.Cache.Store(probeID, res)
	emit(job.Event{
		Stage:          "done",
		ProbeID:        probeID,
		Repo:           &recommend.RepoInfo{URL: res.RepositoryURL, Commit: res.Commit, Languages: res.PrimaryLanguages},
		Recommendation: &refined,
	})
	return nil
}

func newProbeID() string {
	var b [8]byte
	rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
