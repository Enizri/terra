// Package ask prepares grounded context for analyzer QA tasks.
package ask

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/Enizri/terra/backend/api/internal/analysis"
	"github.com/Enizri/terra/backend/api/internal/analyzerclient"
	"github.com/Enizri/terra/backend/api/internal/preview"
	"github.com/Enizri/terra/backend/api/internal/scan"
	"github.com/Enizri/terra/backend/api/internal/store"
)

type Input struct {
	RepoURL, Question string
	Selection         map[string]any
	Selections        []map[string]any
	Model             analyzerclient.LLMOpts
	Preview           preview.Runner
	CheckoutBase, DB  string
}

// BuildPayload adds source and map context to one QA request.
func BuildPayload(in Input) map[string]any {
	sels := in.Selections
	if len(sels) == 0 && in.Selection != nil {
		sels = []map[string]any{in.Selection}
	}
	primary := in.Selection
	if primary == nil && len(sels) > 0 {
		primary = sels[len(sels)-1]
	}
	if primary == nil {
		primary = map[string]any{}
	}

	payload := map[string]any{"question": in.Question, "selection": primary}
	if in.Model.Model != "" {
		payload["model"] = in.Model.Model
		payload["base_url"] = in.Model.BaseURL
		if in.Model.APIKey != "" {
			payload["api_key"] = in.Model.APIKey
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
		if snip := snippet(in.Preview, in.CheckoutBase, in.RepoURL, file, line); snip != "" {
			payload["file_snippet"] = snip
		}
	}
	if repoMap := storedMap(in.DB, in.RepoURL); repoMap != nil {
		payload["map"] = repoMap
	}
	return payload
}

// snippet returns about 150 lines centered on line from an existing checkout.
func snippet(r preview.Runner, checkoutBase, repoURL, file string, line int) string {
	if r == nil || strings.Contains(file, "..") {
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

func storedMap(dbPath, repoURL string) *analysis.Map {
	if dbPath == "" {
		return nil
	}
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
