package graph

import (
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
