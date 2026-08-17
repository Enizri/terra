// Package store persists maps in a local SQLite file, keyed by repository URL.
// The real payload is projects.map_json; Get/Find/List read that blob only.
// There is no migration framework — if the on-disk shape changes, delete terra.db.
package store

import (
	"database/sql"
	"encoding/json"
	"fmt"

	_ "modernc.org/sqlite" // pure-Go driver, registered as "sqlite"

	"github.com/Enizri/terra/internal/graph"
	"github.com/Enizri/terra/internal/scan"
)

const schema = `
CREATE TABLE IF NOT EXISTS projects (
	id          INTEGER PRIMARY KEY,
	repo_url    TEXT UNIQUE NOT NULL,
	name        TEXT,
	commit_hash TEXT,
	scanned_at  TEXT,
	map_json    TEXT
);`

// open opens dbPath with WAL + busy_timeout and ensures the schema exists.
func open(dbPath string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		db.Close()
		return nil, fmt.Errorf("enable WAL: %w", err)
	}
	if _, err := db.Exec(`PRAGMA busy_timeout=5000`); err != nil {
		db.Close()
		return nil, fmt.Errorf("set busy_timeout: %w", err)
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("create schema: %w", err)
	}
	return db, nil
}

// Save writes the map to dbPath, replacing whatever was stored for the same
// repository URL.
func Save(dbPath string, res *scan.Result, repoMap *graph.Map) error {
	mapJSON, err := json.Marshal(repoMap)
	if err != nil {
		return err
	}
	db, err := open(dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	_, err = db.Exec(`
		INSERT INTO projects (repo_url, name, commit_hash, scanned_at, map_json)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(repo_url) DO UPDATE SET
			name = excluded.name, commit_hash = excluded.commit_hash,
			scanned_at = excluded.scanned_at, map_json = excluded.map_json`,
		res.RepositoryURL, repoMap.Project.Name, res.Commit, res.ScannedAt.Format("2006-01-02T15:04:05Z"), string(mapJSON),
	)
	if err != nil {
		return fmt.Errorf("upsert project: %w", err)
	}
	return nil
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
	db, err := open(dbPath)
	if err != nil {
		return nil, err
	}
	defer db.Close()

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

// Delete removes one stored analysis.
// Returns false when the id is not in the database.
func Delete(dbPath string, id int64) (bool, error) {
	db, err := open(dbPath)
	if err != nil {
		return false, err
	}
	defer db.Close()

	res, err := db.Exec("DELETE FROM projects WHERE id = ?", id)
	if err != nil {
		return false, fmt.Errorf("delete project: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// Get returns the stored map for one analysis, or (nil, nil) when the id is
// not in the database.
func Get(dbPath string, id int64) (*graph.Map, error) {
	db, err := open(dbPath)
	if err != nil {
		return nil, err
	}
	defer db.Close()

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
	db, err := open(dbPath)
	if err != nil {
		return "", nil, err
	}
	defer db.Close()

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
