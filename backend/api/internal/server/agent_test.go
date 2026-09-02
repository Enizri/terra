package server

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/Enizri/terra/backend/api/internal/job"
)

func TestEnqueueAgentStreamsRetrieveAndTool(t *testing.T) {
	s, ts := testServer(t)
	var task string
	var payload map[string]any
	s.StreamTask = func(ctx context.Context, name string, p any, emit func(job.Event)) (string, error) {
		task = name
		payload, _ = p.(map[string]any)
		emit(job.Event{Stage: "retrieve", Label: "lookup_component"})
		emit(job.Event{Stage: "tool", Label: "read_snippet"})
		return "auth owns SSO", nil
	}
	s.RunTask = func(ctx context.Context, name string, p any) (json.RawMessage, error) {
		t.Fatalf("agent job must not call RunTask (%s)", name)
		return nil, nil
	}

	events := runJob(t, ts, "/jobs/agent",
		`{"repo_url":"https://github.com/acme/notes","question":"How does SSO work?"}`)

	if task != "agent" {
		t.Fatalf("task = %q, want agent", task)
	}
	if payload["question"] != "How does SSO work?" {
		t.Errorf("payload = %+v", payload)
	}
	got := strings.Join(stages(events), ",")
	if !strings.Contains(got, "retrieve") || !strings.Contains(got, "tool") {
		t.Fatalf("stages = %s, want retrieve and tool", got)
	}
	var retrieve, tool job.Event
	for _, ev := range events {
		if ev.Stage == "retrieve" {
			retrieve = ev
		}
		if ev.Stage == "tool" {
			tool = ev
		}
	}
	if retrieve.Label != "lookup_component" || tool.Label != "read_snippet" {
		t.Errorf("labels retrieve=%q tool=%q", retrieve.Label, tool.Label)
	}
	done := lastEvent(t, events)
	if done.Stage != "done" || done.Answer != "auth owns SSO" {
		t.Fatalf("done = %+v", done)
	}
}

func TestJobsAskStillUsesQA(t *testing.T) {
	s, ts := testServer(t)
	var name string
	s.RunTask = func(ctx context.Context, n string, p any) (json.RawMessage, error) {
		name = n
		return json.RawMessage(`{"answer":"from qa"}`), nil
	}
	s.StreamTask = func(ctx context.Context, n string, p any, emit func(job.Event)) (string, error) {
		t.Fatal("/jobs/ask must not stream the agent task")
		return "", nil
	}

	events := runJob(t, ts, "/jobs/ask",
		`{"repo_url":"https://github.com/acme/notes","question":"where?"}`)
	if name != "qa" {
		t.Fatalf("task = %q, want qa", name)
	}
	done := lastEvent(t, events)
	if done.Stage != "done" || done.Answer != "from qa" {
		t.Fatalf("done = %+v", done)
	}
}

func TestAgentLoadsALocalModelBeforeStreaming(t *testing.T) {
	s, ts := testServer(t)
	order := []string{}
	s.EnsureModel = func(ctx context.Context, hfID string, emit func(job.Event)) error {
		order = append(order, "ensure:"+hfID)
		emit(job.Event{Stage: "ensure_model", Label: "Loading " + hfID})
		return nil
	}
	s.StreamTask = func(ctx context.Context, name string, p any, emit func(job.Event)) (string, error) {
		order = append(order, name)
		emit(job.Event{Stage: "retrieve", Label: "lookup_component"})
		return "ok", nil
	}
	events := runJob(t, ts, "/jobs/agent",
		`{"repo_url":"https://github.com/acme/notes","question":"what?","model_id":"local-qwen2.5-1.5b"}`)

	if want := "ensure:" + localHFID + ",agent"; strings.Join(order, ",") != want {
		t.Errorf("order = %v, want %s", order, want)
	}
	if !strings.Contains(strings.Join(stages(events), ","), "ensure_model") {
		t.Errorf("stages = %v, want ensure_model", stages(events))
	}
}

func TestAgentErrorsAreScrubbed(t *testing.T) {
	s, ts := testServer(t)
	s.StreamTask = func(ctx context.Context, name string, p any, emit func(job.Event)) (string, error) {
		emit(job.Event{Stage: "tool", Label: "read_snippet " + leakKey})
		return "", fmt.Errorf("analyzer: provider rejected key %s", leakKey)
	}
	events := runJob(t, ts, "/jobs/agent",
		`{"repo_url":"https://github.com/acme/notes","question":"what?","model_id":"openai-gpt-5.4-mini","api_key":"`+leakKey+`"}`)
	for _, ev := range events {
		data, _ := json.Marshal(ev)
		if strings.Contains(string(data), leakKey) {
			t.Errorf("api key leaked into an agent event: %s", data)
		}
		if strings.Contains(ev.Label, "api_key") {
			t.Errorf("api_key appeared in a label: %q", ev.Label)
		}
	}
}

func TestEnqueueAgentRejectsBadModelSelections(t *testing.T) {
	_, ts := testServer(t)
	resp, err := ts.Client().Post(ts.URL+"/jobs/agent", "application/json",
		strings.NewReader(`{"repo_url":"https://github.com/acme/notes","question":"what?","model_id":"does-not-exist"}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}
