// Package llmlocal drives the Terra host's model sidecar
// (backend/local-llm/terra_local_llm) so an analyze job can switch weights
// without an operator editing .env and restarting anything.
package llmlocal

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Enizri/terra/backend/api/internal/job"
)

// pollEvery is how often EnsureModel re-checks a load in flight. Downloads run
// for minutes, so a tight loop buys nothing.
var pollEvery = 2 * time.Second

// client talks to a process on this machine; a load is asynchronous, so no
// request here should ever be slow.
var client = &http.Client{Timeout: 30 * time.Second}

type status struct {
	ModelID string `json:"model_id"`
	Device  string `json:"device"`
	State   string `json:"state"` // ready | loading | error | empty
	Error   string `json:"error"`
}

// EnsureModel makes the sidecar at base serve hfID, emitting coarse progress.
// It returns once the weights are ready, or with an error the job surfaces.
func EnsureModel(ctx context.Context, base, hfID string, emit func(job.Event)) error {
	base = strings.TrimSuffix(base, "/")

	st, err := getStatus(ctx, base)
	if err != nil {
		return fmt.Errorf("cannot reach the local model server at %s: %w\n"+
			"start it with `make run-llm`, or pick a hosted model", base, err)
	}
	if st.State == "ready" && st.ModelID == hfID {
		return nil
	}

	emit(job.Event{Stage: "ensure_model", Label: "Preparing " + hfID + " on this machine"})
	if st.State != "loading" || st.ModelID != hfID {
		if err := startLoad(ctx, base, hfID); err != nil {
			return err
		}
	}
	emit(job.Event{Stage: "ensure_model", Label: "Downloading and loading " + hfID + " — this can take a while"})

	err = waitReady(ctx, base, hfID, emit)
	if ctx.Err() != nil {
		// Nobody is waiting on these weights any more. Telling the sidecar
		// keeps the abandoned load from becoming the active model, and lets
		// the next pick take over instead of queueing behind it.
		cancelLoad(base)
		return ctx.Err()
	}
	return err
}

// waitReady polls until the sidecar is serving hfID, or gives up.
func waitReady(ctx context.Context, base, hfID string, emit func(job.Event)) error {
	ticker := time.NewTicker(pollEvery)
	defer ticker.Stop()
	tookOver := false
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
		st, err := getStatus(ctx, base)
		if err != nil {
			return fmt.Errorf("lost contact with the local model server: %w", err)
		}
		switch st.State {
		case "empty":
			// Nothing is in flight: the job that was loading these weights
			// cancelled, which bumps the generation and clears the marker, so
			// its worker will throw the download away. Waiting would block
			// until the analyze timeout, so take the load over once.
			if tookOver {
				return fmt.Errorf("the local model server keeps dropping the load of %s", hfID)
			}
			tookOver = true
			if err := startLoad(ctx, base, hfID); err != nil {
				return err
			}
		case "ready":
			if st.ModelID != hfID {
				// Someone else switched the sidecar out from under this job.
				return fmt.Errorf("the local model server is serving %s, not %s", st.ModelID, hfID)
			}
			emit(job.Event{Stage: "ensure_model", Label: hfID + " is ready"})
			return nil
		case "error":
			return fmt.Errorf("could not load %s: %s\ntry a smaller local model, or a hosted one", hfID, st.Error)
		}
	}
}

func getStatus(ctx context.Context, base string) (status, error) {
	var st status
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/admin/status", nil)
	if err != nil {
		return st, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return st, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode != http.StatusOK {
		return st, fmt.Errorf("%s: %s", resp.Status, strings.TrimSpace(string(data)))
	}
	if err := json.Unmarshal(data, &st); err != nil {
		return st, fmt.Errorf("unexpected reply from %s: %w", base, err)
	}
	return st, nil
}

// cancelLoad abandons the load in flight. Best effort: the job's context is
// already dead, so this gets a fresh short-lived one, and a sidecar that
// cannot be reached is nothing the cancelled job can act on.
func cancelLoad(base string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/admin/cancel", nil)
	if err != nil {
		return
	}
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()
}

func startLoad(ctx context.Context, base, hfID string) error {
	body, _ := json.Marshal(map[string]string{"model_id": hfID})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/admin/load", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("cannot ask the local model server to load %s: %w", hfID, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	// Current sidecars supersede rather than conflict, but an older one 409s
	// when a load is already in flight; the poll loop handles that fine.
	if resp.StatusCode == http.StatusConflict {
		return nil
	}
	if resp.StatusCode != http.StatusOK {
		var errBody struct {
			Detail any `json:"detail"`
		}
		if json.Unmarshal(data, &errBody) == nil && errBody.Detail != nil {
			return fmt.Errorf("local model server: %v", errBody.Detail)
		}
		return fmt.Errorf("local model server: %s", resp.Status)
	}
	return nil
}
