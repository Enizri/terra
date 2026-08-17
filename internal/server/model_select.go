package server

import (
	"context"
	"strings"

	"github.com/Enizri/terra/internal/analyzerclient"
	"github.com/Enizri/terra/internal/catalog"
	"github.com/Enizri/terra/internal/config"
	"github.com/Enizri/terra/internal/job"
)

// modelSelection is a catalog entry resolved against this deployment: where
// the analyzer should send the request, and whether the host sidecar has to
// load weights first.
//
// A zero selection (no model_id on the request) means "operator's choice" and
// leaves the analyzer on its TERRA_LLM_* environment.
type modelSelection struct {
	Opts  analyzerclient.LLMOpts
	Local bool
	// HFID is the weights the sidecar must have loaded; local entries only.
	HFID string
}

// resolveModel turns a catalog entry into routing. apiKey is request-scoped
// and only ever ends up inside Opts, which goes straight to the analyzer.
func resolveModel(cfg *config.Config, entry *catalog.Entry, apiKey string) modelSelection {
	if entry == nil {
		return modelSelection{}
	}
	if entry.Kind == catalog.KindLocal {
		// The sidecar serves whatever it has loaded under its HF id, so the
		// model string and the weights id are the same thing.
		return modelSelection{
			Opts:  analyzerclient.LLMOpts{Model: entry.HFID, BaseURL: cfg.LocalLLMURL},
			Local: true,
			HFID:  entry.HFID,
		}
	}
	return modelSelection{
		Opts: analyzerclient.LLMOpts{Model: entry.Model, BaseURL: entry.BaseURL, APIKey: apiKey},
	}
}

// ensureModel makes the host sidecar serve hfID, streaming coarse progress.
// Nil EnsureModel means no sidecar orchestration is configured: assume the
// operator started one already and let the analyzer's preflight complain.
func (s *Server) ensureModel(ctx context.Context, hfID string, emit func(job.Event)) error {
	if s.EnsureModel == nil {
		return nil
	}
	return s.EnsureModel(ctx, hfID, emit)
}

// scrub removes secret from text. Providers echo request material into their
// error bodies and analyzerclient.Analyze wraps those verbatim, so every label built
// from an analyzer error passes through here before it becomes an event.
func scrub(text, secret string) string {
	if secret == "" {
		return text
	}
	return strings.ReplaceAll(text, secret, "[redacted]")
}
