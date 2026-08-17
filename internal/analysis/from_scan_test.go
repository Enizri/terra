package analysis

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"

	"github.com/Enizri/terra/internal/scan"
)

func TestFromScanBuildsComponentsFromTopLevelDirs(t *testing.T) {
	res := &scan.Result{
		RepositoryURL:    "https://github.com/acme/notes",
		Name:             "notes",
		Commit:           "abc",
		ScannedAt:        time.Now().UTC(),
		PrimaryLanguages: []string{"TypeScript", "Go"},
		Languages: []scan.LanguageStat{
			{Name: "TypeScript", Files: 6, Bytes: 6000},
			{Name: "Go", Files: 4, Bytes: 4000},
		},
		Stats: scan.Stats{SourceFiles: 10, TopLevelDirs: []string{"web", "api"}},
		Tree: []scan.DirSummary{
			{Path: "web", Files: 6, Languages: []string{"TypeScript"}},
			{Path: "api", Files: 4, Languages: []string{"Go"}},
		},
		Files: []string{"web/app.ts", "web/main.tsx", "api/main.go", "api/store.go"},
		Dependencies: []scan.Manifest{
			{Manifest: "web/package.json", Ecosystem: "npm", Names: []string{"react"}},
			{Manifest: "go.mod", Ecosystem: "go", Names: []string{"chi"}},
		},
	}
	m := FromScan(res)
	if m.Project.Kind != "structural" {
		t.Fatalf("kind = %q", m.Project.Kind)
	}
	if m.Project.Name != "Notes" {
		t.Fatalf("name = %q", m.Project.Name)
	}
	if len(m.Components) != 2 {
		t.Fatalf("components = %d, want 2", len(m.Components))
	}
	byID := map[string]Component{}
	for _, c := range m.Components {
		byID[c.ID] = c
	}
	if byID["web"].Type != "frontend" {
		t.Errorf("web type = %q, want frontend", byID["web"].Type)
	}
	if byID["api"].Type != "backend" {
		t.Errorf("api type = %q, want backend", byID["api"].Type)
	}
	if len(m.Relationships) != 1 || m.Relationships[0].From != "web" || m.Relationships[0].To != "api" {
		t.Errorf("relationships = %+v, want web→api", m.Relationships)
	}
	if len(m.SuggestedQuestions) != 0 {
		t.Errorf("suggested_questions should stay empty until the LLM map")
	}
}

func TestFromScanEmptyTreeGetsRootComponent(t *testing.T) {
	res := &scan.Result{
		RepositoryURL:    "https://github.com/acme/lib",
		Name:             "lib",
		PrimaryLanguages: []string{"Go"},
		Stats:            scan.Stats{SourceFiles: 2},
		Files:            []string{"main.go", "util.go"},
	}
	m := FromScan(res)
	if len(m.Components) != 1 || m.Components[0].ID != "repo" {
		t.Fatalf("components = %+v, want single repo root", m.Components)
	}
	if m.Components[0].Type != "backend" {
		t.Errorf("type = %q, want backend for Go lib", m.Components[0].Type)
	}
}

// TestFromScanAlwaysDrawsAConnectedGraph pins the structural map invariants that
// the frontend relies on: connected blocks, valid verbs, and no JSON nulls.
func TestFromScanAlwaysDrawsAConnectedGraph(t *testing.T) {
	verbs := map[string]bool{
		"calls": true, "exposes": true, "uses": true, "reads": true, "reads_writes": true,
		"guarded_by": true, "notifies": true, "hosts": true, "initializes": true, "upgraded_by": true,
	}
	cases := []struct {
		name string
		res  *scan.Result
	}{
		{
			name: "python only",
			res: &scan.Result{
				RepositoryURL:    "https://github.com/NousResearch/hermes-agent",
				Name:             "hermes-agent",
				PrimaryLanguages: []string{"Python"},
				Stats:            scan.Stats{SourceFiles: 90, TopLevelDirs: []string{"hermes_agent", "tests", "docs"}},
				Tree: []scan.DirSummary{
					{Path: "hermes_agent", Files: 70, Languages: []string{"Python"}},
					{Path: "tests", Files: 18, Languages: []string{"Python"}},
					{Path: "docs", Files: 2, Languages: []string{"Markdown"}},
				},
				Files:        []string{"hermes_agent/main.py", "tests/test_main.py", "docs/index.md"},
				Dependencies: []scan.Manifest{{Manifest: "pyproject.toml", Ecosystem: "pip", Names: []string{"pydantic"}}},
			},
		},
		{
			name: "frontend and backend",
			res: &scan.Result{
				RepositoryURL:    "https://github.com/acme/terra",
				Name:             "terra",
				PrimaryLanguages: []string{"TypeScript", "Go"},
				Stats:            scan.Stats{SourceFiles: 40, TopLevelDirs: []string{"web", "internal", "cmd"}},
				Tree: []scan.DirSummary{
					{Path: "web", Files: 20, Languages: []string{"TypeScript"}},
					{Path: "internal", Files: 16, Languages: []string{"Go"}},
					{Path: "cmd", Files: 4, Languages: []string{"Go"}},
				},
				Files: []string{"web/app.tsx", "internal/server/server.go", "cmd/terra/main.go"},
				Dependencies: []scan.Manifest{
					{Manifest: "web/package.json", Ecosystem: "npm"},
					{Manifest: "go.mod", Ecosystem: "go"},
				},
			},
		},
		{
			name: "empty repo",
			res:  &scan.Result{RepositoryURL: "https://github.com/acme/empty", Name: "empty"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := FromScan(tc.res)
			ids := map[string]bool{}
			for _, c := range m.Components {
				ids[c.ID] = true
			}
			endpoint := map[string]bool{}
			for _, r := range m.Relationships {
				if r.From == r.To {
					t.Errorf("self-edge on %q", r.From)
				}
				if !ids[r.From] || !ids[r.To] {
					t.Errorf("relationship %q -> %q references an unknown component", r.From, r.To)
				}
				if !verbs[r.Type] {
					t.Errorf("verb %q outside RELATION_VERBS", r.Type)
				}
				if n := len(r.Because); n < 1 || n > 3 {
					t.Errorf("relationship %q -> %q has %d because entries, want 1-3", r.From, r.To, n)
				}
				endpoint[r.From], endpoint[r.To] = true, true
			}
			if len(m.Components) > 1 {
				for _, c := range m.Components {
					if !endpoint[c.ID] {
						t.Errorf("component %q is orphaned", c.ID)
					}
				}
			}

			raw, err := json.Marshal(m)
			if err != nil {
				t.Fatal(err)
			}
			for _, field := range []string{"relationships", "suggested_questions", "primary_languages", "top_level_dirs"} {
				if bytes.Contains(raw, []byte(`"`+field+`":null`)) {
					t.Errorf("%s marshalled as null: %s", field, raw)
				}
			}
		})
	}
}
