package store

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/Enizri/terra/internal/graph"
	"github.com/Enizri/terra/internal/scan"
)

func ptr(s string) *string { return &s }

func fixtures() (*scan.Result, *graph.Map) {
	res := &scan.Result{
		RepositoryURL: "https://github.com/usememos/memos",
		Name:          "memos",
		Commit:        "571e0a3",
		ScannedAt:     time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC),
	}
	m := &graph.Map{
		Project: graph.Project{Name: "Memos", RepositoryURL: res.RepositoryURL},
		Components: []graph.Component{
			{ID: "web", Name: "Web Application", Purpose: "What the user sees.",
				Importance: "critical", Type: "frontend", Tech: []string{"React"}, Files: []string{"web/src/"}},
			{ID: "web.editor", ParentID: ptr("web"), Name: "Editor", Purpose: "Where you write.",
				Importance: "high", Type: "frontend", Files: []string{"web/src/App.tsx"}},
		},
		Relationships: []graph.Relationship{
			{From: "web.editor", To: "web", Type: "uses", Because: []string{"web/src/App.tsx"}},
		},
	}
	return res, m
}

func count(t *testing.T, db *sql.DB, table string) int {
	t.Helper()
	var n int
	if err := db.QueryRow("SELECT count(*) FROM " + table).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

func TestSaveRoundTripAndUpsert(t *testing.T) {
	path := filepath.Join(t.TempDir(), "terra.db")
	res, m := fixtures()

	if err := Save(path, res, m); err != nil {
		t.Fatal(err)
	}
	// Saving the same repository again must replace, not accumulate.
	m.Components = append(m.Components, graph.Component{ID: "data", Name: "Data Storage",
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

	if n := count(t, db, "projects"); n != 1 {
		t.Errorf("projects = %d, want 1", n)
	}
	if n := count(t, db, "components"); n != 3 {
		t.Errorf("components = %d, want 3", n)
	}
	if n := count(t, db, "relationships"); n != 1 {
		t.Errorf("relationships = %d, want 1", n)
	}

	var commit, mapJSON string
	if err := db.QueryRow("SELECT commit_hash, map_json FROM projects").Scan(&commit, &mapJSON); err != nil {
		t.Fatal(err)
	}
	if commit != "deadbee" {
		t.Errorf("commit_hash = %q, want the second scan's", commit)
	}
	var stored graph.Map
	if err := json.Unmarshal([]byte(mapJSON), &stored); err != nil {
		t.Fatalf("map_json is not a map: %v", err)
	}
	if len(stored.Components) != 3 || stored.Project.Name != "Memos" {
		t.Errorf("map_json blob does not match what was saved: %+v", stored.Project)
	}

	// Column-level round trip of one component.
	var parent sql.NullString
	var name, techJSON, filesJSON string
	err = db.QueryRow(`SELECT parent_id, name, tech_json, files_json FROM components
		WHERE project_id = 1 AND id = 'web.editor'`).Scan(&parent, &name, &techJSON, &filesJSON)
	if err != nil {
		t.Fatal(err)
	}
	if !parent.Valid || parent.String != "web" {
		t.Errorf("parent_id = %v, want web", parent)
	}
	if name != "Editor" || filesJSON != `["web/src/App.tsx"]` || techJSON != `[]` {
		t.Errorf("component round trip wrong: %q %q %q", name, filesJSON, techJSON)
	}

	if err := db.QueryRow("SELECT parent_id FROM components WHERE id = 'web'").Scan(&parent); err != nil {
		t.Fatal(err)
	}
	if parent.Valid {
		t.Errorf("a top-level component should store NULL, got %q", parent.String)
	}

	var from, to, becauseJSON string
	if err := db.QueryRow("SELECT from_id, to_id, because_json FROM relationships").Scan(&from, &to, &becauseJSON); err != nil {
		t.Fatal(err)
	}
	if from != "web.editor" || to != "web" || becauseJSON != `["web/src/App.tsx"]` {
		t.Errorf("relationship round trip wrong: %s -> %s %s", from, to, becauseJSON)
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
	if list[1].RepoURL != res.RepositoryURL || list[1].ID == 0 {
		t.Errorf("list[1] = %+v", list[1])
	}

	got, err := Get(path, list[1].ID)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.Project.Name != "Memos" || len(got.Components) != 2 {
		t.Errorf("Get = %+v", got)
	}
	if got.Components[1].ParentID == nil || *got.Components[1].ParentID != "web" {
		t.Errorf("parent_id lost in round trip: %+v", got.Components[1])
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
	if len(list) != 2 {
		t.Fatalf("list = %d rows, want 2", len(list))
	}
	target := list[1].ID
	if list[1].RepoURL != res.RepositoryURL {
		t.Fatalf("list[1] = %+v, want memos row", list[1])
	}

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

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if n := count(t, db, "projects"); n != 1 {
		t.Errorf("projects = %d, want 1", n)
	}
	if n := count(t, db, "components"); n != 2 {
		t.Errorf("components = %d, want 2", n)
	}

	ok, err = Delete(path, target)
	if err != nil || ok {
		t.Errorf("Delete again = %v, %v; want false, nil", ok, err)
	}
	ok, err = Delete(path, 999)
	if err != nil || ok {
		t.Errorf("Delete(999) = %v, %v; want false, nil", ok, err)
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
	if err := Save(path, other, otherMap); err != nil {
		t.Fatal(err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if n := count(t, db, "projects"); n != 2 {
		t.Errorf("projects = %d, want 2", n)
	}
	if n := count(t, db, "components"); n != 4 {
		t.Errorf("components = %d, want 4", n)
	}
}
