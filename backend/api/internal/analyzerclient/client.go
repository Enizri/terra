// Package analyzerclient is the HTTP adapter to the Python analyzer process.
package analyzerclient

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Enizri/terra/backend/api/internal/analysis"
	"github.com/Enizri/terra/backend/api/internal/scan"
)

// DefaultAnalyzerURL is the analyzer base URL (override with TERRA_ANALYZER_URL).
const DefaultAnalyzerURL = "http://localhost:8010"

var client = &http.Client{Timeout: 20 * time.Minute}

// probeClient keeps a dead analyzer from costing the full request timeout.
var probeClient = &http.Client{Timeout: 5 * time.Second}

// draft is the analyzer response (judgement fields only).
type draft struct {
	Description        string                  `json:"description"`
	Kind               string                  `json:"kind"`
	Components         []analysis.Component    `json:"components"`
	Relationships      []analysis.Relationship `json:"relationships"`
	SuggestedQuestions []string                `json:"suggested_questions"`
}

// LLMOpts routes one analyze request. Empty fields leave the analyzer on its
// own TERRA_LLM_* environment, so an operator-configured deployment behaves
// exactly as it did before the workspace picker existed.
//
// APIKey is request-scoped secret material: it lives here and in the analyzer
// request body only. It must never reach a job event, a log line, or the store.
type LLMOpts struct {
	Model   string
	BaseURL string
	APIKey  string
}

// Analyze sends the scan to the analyzer at base (config.AnalyzerURL) and
// returns an assembled Map.
func Analyze(ctx context.Context, base string, res *scan.Result, opts LLMOpts) (*analysis.Map, []string, error) {
	base = strings.TrimSuffix(base, "/")
	if base == "" {
		base = DefaultAnalyzerURL
	}
	if err := preflight(ctx, base); err != nil {
		return nil, nil, err
	}

	// Only non-empty overrides go on the wire: an unrouted request marshals
	// byte-for-byte the same body the analyzer has always received.
	payload := map[string]any{"scan": res, "model": opts.Model}
	if opts.BaseURL != "" {
		payload["base_url"] = opts.BaseURL
	}
	if opts.APIKey != "" {
		payload["api_key"] = opts.APIKey
	}
	body, err := json.Marshal(payload)
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
	return analysis.Assemble(res, analysis.Draft{
		Description:        out.Draft.Description,
		Kind:               out.Draft.Kind,
		Components:         out.Draft.Components,
		Relationships:      out.Draft.Relationships,
		SuggestedQuestions: out.Draft.SuggestedQuestions,
	}), out.Warnings, nil
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

// TaskEvent is one NDJSON line from a streaming analyzer task.
// Stage/Label are progress; Answer is the terminal payload; Error is a
// mid-stream failure. API keys must never be copied into Stage or Label.
type TaskEvent struct {
	Stage  string `json:"stage,omitempty"`
	Label  string `json:"label,omitempty"`
	Answer string `json:"answer,omitempty"`
	Error  string `json:"error,omitempty"`
}

const streamLineCap = 1 << 20

// StreamTask posts payload to /tasks/{name} and reads NDJSON events.
// Progress lines are forwarded to emit; the final {answer} is returned.
func StreamTask(ctx context.Context, base, name string, payload any, emit func(TaskEvent)) (string, error) {
	base = strings.TrimSuffix(base, "/")
	if base == "" {
		base = DefaultAnalyzerURL
	}
	if err := preflight(ctx, base); err != nil {
		return "", err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	resp, err := post(ctx, base+"/tasks/"+name, body)
	if err != nil {
		return "", fmt.Errorf("analyzer: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return "", taskHTTPError(resp.Status, data)
	}

	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 64*1024), streamLineCap)
	answer := ""
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var ev TaskEvent
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			return "", fmt.Errorf("analyzer: unexpected reply: %w", err)
		}
		if ev.Error != "" {
			return "", fmt.Errorf("analyzer: %s", ev.Error)
		}
		if ev.Stage != "" && emit != nil {
			emit(TaskEvent{Stage: ev.Stage, Label: ev.Label})
		}
		if ev.Answer != "" {
			answer = ev.Answer
		}
	}
	if err := sc.Err(); err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", fmt.Errorf("analyzer: %w", err)
	}
	if answer == "" {
		return "", fmt.Errorf("analyzer: streaming task %s ended without an answer", name)
	}
	return answer, nil
}

func taskHTTPError(status string, data []byte) error {
	var errBody struct {
		Detail any `json:"detail"`
	}
	if json.Unmarshal(data, &errBody) == nil && errBody.Detail != nil {
		return fmt.Errorf("analyzer: %v", errBody.Detail)
	}
	return fmt.Errorf("analyzer: %s: %s", status, strings.TrimSpace(string(data)))
}

func post(ctx context.Context, url string, body []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return client.Do(req)
}

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
