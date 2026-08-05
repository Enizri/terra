package graph

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode"

	"terra/internal/scan"
)

// DefaultAnalyzerURL is where the Python analyzer service listens; override
// with TERRA_ANALYZER_URL.
const DefaultAnalyzerURL = "http://localhost:8010"

// ponytail: analysis on a laptop model takes minutes; swap for a
// context-based deadline if callers ever need cancelling.
var client = &http.Client{Timeout: 20 * time.Minute}

// draft is what the analyzer returns: everything that required judgement,
// and nothing the scan already knows for certain.
type draft struct {
	Description        string         `json:"description"`
	Kind               string         `json:"kind"`
	Components         []Component    `json:"components"`
	Relationships      []Relationship `json:"relationships"`
	SuggestedQuestions []string       `json:"suggested_questions"`
}

// Analyze sends the scan to the Python analyzer service and assembles its
// draft with the facts the scan already knows.
func Analyze(res *scan.Result, model string) (*Map, []string, error) {
	base := strings.TrimSuffix(os.Getenv("TERRA_ANALYZER_URL"), "/")
	if base == "" {
		base = DefaultAnalyzerURL
	}
	if err := preflight(base); err != nil {
		return nil, nil, err
	}

	body, err := json.Marshal(map[string]any{"scan": res, "model": model})
	if err != nil {
		return nil, nil, err
	}
	resp, err := client.Post(base+"/analyze", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, nil, fmt.Errorf("analyzer: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("analyzer: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		// The analyzer puts its legible error message in .detail.
		var e struct {
			Detail any `json:"detail"`
		}
		if json.Unmarshal(data, &e) == nil && e.Detail != nil {
			return nil, nil, fmt.Errorf("analyzer: %v", e.Detail)
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

// RunTask posts payload to the analyzer's generic /tasks/{name} endpoint and
// returns the raw JSON result.
func RunTask(name string, payload any) (json.RawMessage, error) {
	base := strings.TrimSuffix(os.Getenv("TERRA_ANALYZER_URL"), "/")
	if base == "" {
		base = DefaultAnalyzerURL
	}
	if err := preflight(base); err != nil {
		return nil, err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	resp, err := client.Post(base+"/tasks/"+name, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("analyzer: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("analyzer: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Detail any `json:"detail"`
		}
		if json.Unmarshal(data, &e) == nil && e.Detail != nil {
			return nil, fmt.Errorf("analyzer: %v", e.Detail)
		}
		return nil, fmt.Errorf("analyzer: %s: %s", resp.Status, strings.TrimSpace(string(data)))
	}
	return data, nil
}

// preflight fails early and legibly rather than letting a missing service
// turn into a confusing HTTP error after minutes of scanning.
func preflight(base string) error {
	resp, err := client.Get(base + "/healthz")
	if err != nil {
		return fmt.Errorf("cannot reach the analyzer service at %s: %w\nstart it with `make run-analyzer`, or set TERRA_ANALYZER_URL", base, err)
	}
	resp.Body.Close()
	return nil
}

// assemble combines what the analyzer judged with what the scan already
// knows. Nothing the scan can state as fact is left for the model to invent.
func assemble(res *scan.Result, d *draft) *Map {
	return &Map{
		Project: Project{
			Name:             titleCase(res.Name),
			RepositoryURL:    res.RepositoryURL,
			Description:      strings.TrimSpace(d.Description),
			Kind:             strings.TrimSpace(d.Kind),
			PrimaryLanguages: res.PrimaryLanguages,
			Stats: ProjectStats{
				ApproxSourceFiles: res.Stats.SourceFiles,
				TopLevelDirs:      res.Stats.TopLevelDirs,
			},
		},
		Components:         d.Components,
		Relationships:      d.Relationships,
		SuggestedQuestions: d.SuggestedQuestions,
	}
}

func titleCase(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}
