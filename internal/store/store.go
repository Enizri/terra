// Package store persists maps in a local SQLite file, keyed by repository URL.
package store

import (
	"database/sql"
	"encoding/json"
	"fmt"

	_ "modernc.org/sqlite" // pure-Go driver, registered as "sqlite"

	"github.com/Enizri/terra/internal/graph"
	"github.com/Enizri/terra/internal/scan"
)

// ponytail: created on open, no versioning. When the shape changes, delete
// terra.db — bring in a migration tool once maps are worth keeping.
const schema = `
CREATE TABLE IF NOT EXISTS projects (
	id          INTEGER PRIMARY KEY,
	repo_url    TEXT UNIQUE NOT NULL,
	name        TEXT,
	commit_hash TEXT,
	scanned_at  TEXT,
	map_json    TEXT
);
CREATE TABLE IF NOT EXISTS components (
	project_id INTEGER NOT NULL,
	id         TEXT NOT NULL,
	parent_id  TEXT,
	name       TEXT,
	purpose    TEXT,
	importance TEXT,
	type       TEXT,
	tech_json  TEXT,
	files_json TEXT,
	PRIMARY KEY (project_id, id)
);
CREATE TABLE IF NOT EXISTS relationships (
	project_id   INTEGER NOT NULL,
	from_id      TEXT NOT NULL,
	to_id        TEXT NOT NULL,
	type         TEXT,
	because_json TEXT
);`

// Save writes the map to dbPath, replacing whatever was stored for the same
// repository URL.
func Save(dbPath string, res *scan.Result, repoMap *graph.Map) error {
	mapJSON, err := json.Marshal(repoMap)
	if err != nil {
		return err
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}
	defer db.Close()
	if _, err := db.Exec(schema); err != nil {
		return fmt.Errorf("create schema: %w", err)
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var projectID int64
	err = tx.QueryRow(`
		INSERT INTO projects (repo_url, name, commit_hash, scanned_at, map_json)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(repo_url) DO UPDATE SET
			name = excluded.name, commit_hash = excluded.commit_hash,
			scanned_at = excluded.scanned_at, map_json = excluded.map_json
		RETURNING id`,
		res.RepositoryURL, repoMap.Project.Name, res.Commit, res.ScannedAt.Format("2006-01-02T15:04:05Z"), string(mapJSON),
	).Scan(&projectID)
	if err != nil {
		return fmt.Errorf("upsert project: %w", err)
	}

	for _, table := range []string{"components", "relationships"} {
		if _, err := tx.Exec("DELETE FROM "+table+" WHERE project_id = ?", projectID); err != nil {
			return fmt.Errorf("clear %s: %w", table, err)
		}
	}

	for _, component := range repoMap.Components {
		var parent any
		if component.ParentID != nil {
			parent = *component.ParentID
		}
		if _, err := tx.Exec(`INSERT INTO components
			(project_id, id, parent_id, name, purpose, importance, type, tech_json, files_json)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			projectID, component.ID, parent, component.Name, component.Purpose, component.Importance, component.Type,
			mustJSON(component.Tech), mustJSON(component.Files)); err != nil {
			return fmt.Errorf("insert component %s: %w", component.ID, err)
		}
	}
	for _, rel := range repoMap.Relationships {
		if _, err := tx.Exec(`INSERT INTO relationships
			(project_id, from_id, to_id, type, because_json) VALUES (?, ?, ?, ?, ?)`,
			projectID, rel.From, rel.To, rel.Type, mustJSON(rel.Because)); err != nil {
			return fmt.Errorf("insert relationship %s->%s: %w", rel.From, rel.To, err)
		}
	}
	return tx.Commit()
}

// Summary is one row of the analyses list.
type Summary struct {
	ID        int64  `json:"id"`
	RepoURL   string `json:"repo_url"`
	Name      string `json:"name"`
	ScannedAt string `json:"scanned_at"`
}

// List returns every stored analysis, newest first.
func List(dbPath string) ([]Summary, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("create schema: %w", err)
	}

	rows, err := db.Query(`SELECT id, repo_url, name, scanned_at FROM projects ORDER BY scanned_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Summary{}
	for rows.Next() {
		var row Summary
		if err := rows.Scan(&row.ID, &row.RepoURL, &row.Name, &row.ScannedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// Get returns the stored map for one analysis, or (nil, nil) when the id is
// not in the database.
func Get(dbPath string, id int64) (*graph.Map, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("create schema: %w", err)
	}

	var mapJSON string
	err = db.QueryRow(`SELECT map_json FROM projects WHERE id = ?`, id).Scan(&mapJSON)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var repoMap graph.Map
	if err := json.Unmarshal([]byte(mapJSON), &repoMap); err != nil {
		return nil, fmt.Errorf("stored map for id %d is corrupt: %w", id, err)
	}
	return &repoMap, nil
}

// Find returns the stored commit and map for one repository URL, or
// ("", nil, nil) when the repo has never been analyzed. This is the cache
// lookup that lets a repeat analysis of an unchanged repo skip the analyzer.
func Find(dbPath, repoURL string) (commit string, repoMap *graph.Map, err error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return "", nil, err
	}
	defer db.Close()
	if _, err := db.Exec(schema); err != nil {
		return "", nil, fmt.Errorf("create schema: %w", err)
	}

	var mapJSON string
	err = db.QueryRow(`SELECT commit_hash, map_json FROM projects WHERE repo_url = ?`, repoURL).Scan(&commit, &mapJSON)
	if err == sql.ErrNoRows {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, err
	}
	repoMap = &graph.Map{}
	if err := json.Unmarshal([]byte(mapJSON), repoMap); err != nil {
		return "", nil, fmt.Errorf("stored map for %s is corrupt: %w", repoURL, err)
	}
	return commit, repoMap, nil
}

func mustJSON(items []string) string {
	if items == nil {
		items = []string{}
	}
	b, _ := json.Marshal(items)
	return string(b)
}
