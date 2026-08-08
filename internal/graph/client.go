package graph

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"strings"
	"time"
	"unicode"

	"github.com/Enizri/terra/internal/scan"
)

// DefaultAnalyzerURL is the analyzer base URL (override with TERRA_ANALYZER_URL).
const DefaultAnalyzerURL = "http://localhost:8010"

var client = &http.Client{Timeout: 20 * time.Minute}

// probeClient keeps a dead analyzer from costing the full request timeout.
var probeClient = &http.Client{Timeout: 5 * time.Second}

// draft is the analyzer response (judgement fields only).
type draft struct {
	Description        string         `json:"description"`
	Kind               string         `json:"kind"`
	Components         []Component    `json:"components"`
	Relationships      []Relationship `json:"relationships"`
	SuggestedQuestions []string       `json:"suggested_questions"`
}

// Analyze sends the scan to the analyzer at base (config.AnalyzerURL) and
// returns an assembled Map.
func Analyze(ctx context.Context, base string, res *scan.Result, model string) (*Map, []string, error) {
	base = strings.TrimSuffix(base, "/")
	if base == "" {
		base = DefaultAnalyzerURL
	}
	if err := preflight(ctx, base); err != nil {
		return nil, nil, err
	}

	body, err := json.Marshal(map[string]any{"scan": res, "model": model})
	if err != nil {
		return nil, nil, err
	}
	resp, err := post(ctx, base+"/analyze", body)
	if err != nil {
		return nil, nil, fmt.Errorf("analyzer: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("analyzer: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		var errBody struct {
			Detail any `json:"detail"`
		}
		if json.Unmarshal(data, &errBody) == nil && errBody.Detail != nil {
			return nil, nil, fmt.Errorf("analyzer: %v", errBody.Detail)
		}
		return nil, nil, fmt.Errorf("analyzer: %s: %s", resp.Status, strings.TrimSpace(string(data)))
	}

	var out struct {
		Draft    draft    `json:"draft"`
		Warnings []string `json:"warnings"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, nil, fmt.Errorf("analyzer: unexpected reply: %w", err)
	}
	if len(out.Draft.Components) == 0 {
		return nil, nil, fmt.Errorf("analyzer returned a map with no components")
	}
	return assemble(res, &out.Draft), out.Warnings, nil
}

// RunTask posts payload to /tasks/{name} at base and returns the JSON result.
func RunTask(ctx context.Context, base, name string, payload any) (json.RawMessage, error) {
	base = strings.TrimSuffix(base, "/")
	if base == "" {
		base = DefaultAnalyzerURL
	}
	if err := preflight(ctx, base); err != nil {
		return nil, err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	resp, err := post(ctx, base+"/tasks/"+name, body)
	if err != nil {
		return nil, fmt.Errorf("analyzer: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("analyzer: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		var errBody struct {
			Detail any `json:"detail"`
		}
		if json.Unmarshal(data, &errBody) == nil && errBody.Detail != nil {
			return nil, fmt.Errorf("analyzer: %v", errBody.Detail)
		}
		return nil, fmt.Errorf("analyzer: %s: %s", resp.Status, strings.TrimSpace(string(data)))
	}
	return data, nil
}

// post issues a context-aware JSON POST on the long-request client.
func post(ctx context.Context, url string, body []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return client.Do(req)
}

// preflight checks analyzer /healthz before a long request.
func preflight(ctx context.Context, base string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/healthz", nil)
	if err != nil {
		return err
	}
	resp, err := probeClient.Do(req)
	if err != nil {
		return fmt.Errorf("cannot reach the analyzer service at %s: %w\nstart it with `make run-analyzer`, or set TERRA_ANALYZER_URL", base, err)
	}
	resp.Body.Close()
	return nil
}

// assemble merges scan facts with the analyzer draft.
func assemble(res *scan.Result, draft *draft) *Map {
	return &Map{
		Project: Project{
			Name:             titleCase(res.Name),
			RepositoryURL:    res.RepositoryURL,
			Description:      strings.TrimSpace(draft.Description),
			Kind:             strings.TrimSpace(draft.Kind),
			PrimaryLanguages: res.PrimaryLanguages,
			Stats: ProjectStats{
				ApproxSourceFiles: res.Stats.SourceFiles,
				TopLevelDirs:      res.Stats.TopLevelDirs,
			},
		},
		Components:         draft.Components,
		Relationships:      draft.Relationships,
		SuggestedQuestions: draft.SuggestedQuestions,
	}
}

func titleCase(name string) string {
	runes := []rune(name)
	if len(runes) == 0 {
		return name
	}
	runes[0] = unicode.ToUpper(runes[0])
	return string(runes)
}
