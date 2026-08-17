package store

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Enizri/terra/internal/analysis"
	"github.com/Enizri/terra/internal/scan"
)

func ptr(s string) *string { return &s }

func fixtures() (*scan.Result, *analysis.Map) {
	res := &scan.Result{
		RepositoryURL: "https://github.com/usememos/memos",
		Name:          "memos",
		Commit:        "571e0a3",
		ScannedAt:     time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC),
	}
	m := &analysis.Map{
		Project: analysis.Project{Name: "Memos", RepositoryURL: res.RepositoryURL},
		Components: []analysis.Component{
			{ID: "web", Name: "Web Application", Purpose: "What the user sees.",
				Importance: "critical", Type: "frontend", Tech: []string{"React"}, Files: []string{"web/src/"}},
			{ID: "web.editor", ParentID: ptr("web"), Name: "Editor", Purpose: "Where you write.",
				Importance: "high", Type: "frontend", Files: []string{"web/src/App.tsx"}},
		},
		Relationships: []analysis.Relationship{
			{From: "web.editor", To: "web", Type: "uses", Because: []string{"web/src/App.tsx"}},
		},
	}
	return res, m
}

func countAnalyses(t *testing.T, db *sql.DB) int {
	t.Helper()
	var n int
	if err := db.QueryRow("SELECT count(*) FROM analyses").Scan(&n); err != nil {
		t.Fatalf("count analyses: %v", err)
	}
	return n
}

func TestSaveRoundTripAndUpsert(t *testing.T) {
	path := filepath.Join(t.TempDir(), "terra.db")
	res, m := fixtures()

	if err := Save(path, res, m); err != nil {
		t.Fatal(err)
	}
	m.Components = append(m.Components, analysis.Component{ID: "data", Name: "Data Storage",
		Purpose: "Keeps everything.", Importance: "critical", Type: "database", Files: []string{"store/"}})
	res.Commit = "deadbee"
	if err := Save(path, res, m); err != nil {
		t.Fatal(err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if n := countAnalyses(t, db); n != 1 {
		t.Errorf("analyses = %d, want 1", n)
	}

	var commit, mapJSON string
	var mapVersion int
	if err := db.QueryRow("SELECT commit_hash, map_json, map_version FROM analyses").Scan(&commit, &mapJSON, &mapVersion); err != nil {
		t.Fatal(err)
	}
	if commit != "deadbee" {
		t.Errorf("commit_hash = %q, want the second scan's", commit)
	}
	if mapVersion != analysis.CurrentMapVersion {
		t.Errorf("map_version = %d, want %d", mapVersion, analysis.CurrentMapVersion)
	}
	var stored analysis.Map
	if err := json.Unmarshal([]byte(mapJSON), &stored); err != nil {
		t.Fatalf("map_json is not a map: %v", err)
	}
	if stored.Project.Name != "Memos" || len(stored.Components) != 3 {
		t.Errorf("map_json blob does not match what was saved: %+v", stored)
	}
	if stored.Components[1].ParentID == nil || *stored.Components[1].ParentID != "web" {
		t.Errorf("parent_id lost in map_json: %+v", stored.Components[1])
	}
}

func TestListAndGet(t *testing.T) {
	path := filepath.Join(t.TempDir(), "terra.db")
	res, m := fixtures()
	if err := Save(path, res, m); err != nil {
		t.Fatal(err)
	}
	other, otherMap := fixtures()
	other.RepositoryURL = "https://github.com/usememos/other"
	other.ScannedAt = other.ScannedAt.Add(time.Hour)
	otherMap.Project.Name = "Other"
	if err := Save(path, other, otherMap); err != nil {
		t.Fatal(err)
	}

	list, err := List(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("list = %d rows, want 2", len(list))
	}
	if list[0].Name != "Other" {
		t.Errorf("list[0] = %+v, want newest first", list[0])
	}

	got, err := Get(path, list[1].ID)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.Project.Name != "Memos" || len(got.Components) != 2 {
		t.Errorf("Get = %+v", got)
	}

	missing, err := Get(path, 999)
	if err != nil || missing != nil {
		t.Errorf("Get(999) = %v, %v; want nil, nil", missing, err)
	}
}

func TestListOnEmptyDatabase(t *testing.T) {
	list, err := List(filepath.Join(t.TempDir(), "terra.db"))
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Errorf("list = %v, want empty", list)
	}
}

func TestDelete(t *testing.T) {
	path := filepath.Join(t.TempDir(), "terra.db")
	res, m := fixtures()
	if err := Save(path, res, m); err != nil {
		t.Fatal(err)
	}
	other, otherMap := fixtures()
	other.RepositoryURL = "https://github.com/usememos/other"
	other.ScannedAt = other.ScannedAt.Add(time.Hour)
	if err := Save(path, other, otherMap); err != nil {
		t.Fatal(err)
	}

	list, err := List(path)
	if err != nil {
		t.Fatal(err)
	}
	target := list[1].ID

	ok, err := Delete(path, target)
	if err != nil || !ok {
		t.Fatalf("Delete = %v, %v; want true, nil", ok, err)
	}
	list, err = List(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].RepoURL != other.RepositoryURL {
		t.Fatalf("after delete list = %+v", list)
	}

	ok, err = Delete(path, target)
	if err != nil || ok {
		t.Errorf("Delete again = %v, %v; want false, nil", ok, err)
	}
}

func TestSaveSecondRepositoryKeepsTheFirst(t *testing.T) {
	path := filepath.Join(t.TempDir(), "terra.db")
	res, m := fixtures()
	if err := Save(path, res, m); err != nil {
		t.Fatal(err)
	}
	other, otherMap := fixtures()
	other.RepositoryURL = "https://github.com/usememos/other"
	otherMap.Project.Name = "Other"
	if err := Save(path, other, otherMap); err != nil {
		t.Fatal(err)
	}

	_, firstMap, err := Find(path, res.RepositoryURL)
	if err != nil {
		t.Fatal(err)
	}
	if firstMap == nil || firstMap.Project.Name != "Memos" {
		t.Errorf("first map = %+v", firstMap)
	}
	_, otherStored, err := Find(path, other.RepositoryURL)
	if err != nil {
		t.Fatal(err)
	}
	if otherStored == nil || otherStored.Project.Name != "Other" {
		t.Errorf("second map = %+v", otherStored)
	}
}

// TestMigrateLegacyProjectsTable opens a pre-migration terra.db (projects table,
// no schema_migrations) and checks IDs, URLs, commits, and maps survive.
func TestMigrateLegacyProjectsTable(t *testing.T) {
	src := filepath.Join("testdata", "legacy_projects.db")
	raw, err := os.ReadFile(src)
	if err != nil {
		t.Fatalf("read legacy fixture: %v", err)
	}
	path := filepath.Join(t.TempDir(), "terra.db")
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}

	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open legacy db: %v", err)
	}
	defer s.Close()

	list, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("list = %d, want 1", len(list))
	}
	if list[0].ID != 1 || list[0].RepoURL != "https://github.com/usememos/memos" || list[0].Name != "Memos" {
		t.Errorf("summary = %+v", list[0])
	}

	commit, m, err := s.Find(list[0].RepoURL)
	if err != nil {
		t.Fatal(err)
	}
	if commit != "571e0a3" {
		t.Errorf("commit = %q", commit)
	}
	if m == nil || m.Project.Name != "Memos" || len(m.Components) < 1 {
		t.Errorf("map = %+v", m)
	}

	var ver int
	if err := s.db.QueryRow(`SELECT map_version FROM analyses WHERE id = 1`).Scan(&ver); err != nil {
		t.Fatal(err)
	}
	if ver != 1 {
		t.Errorf("map_version = %d, want 1", ver)
	}

	var maxVer int
	if err := s.db.QueryRow(`SELECT MAX(version) FROM schema_migrations`).Scan(&maxVer); err != nil {
		t.Fatal(err)
	}
	if maxVer < 2 {
		t.Errorf("schema_migrations max = %d, want >= 2", maxVer)
	}

	var projects int
	err = s.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='projects'`).Scan(&projects)
	if err != nil || projects != 0 {
		t.Errorf("projects table still present: count=%d err=%v", projects, err)
	}
}
