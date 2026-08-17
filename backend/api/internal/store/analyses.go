package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/Enizri/terra/backend/api/internal/analysis"
	"github.com/Enizri/terra/backend/api/internal/scan"
)

// Summary is one row of the analyses list.
type Summary struct {
	ID        int64  `json:"id"`
	RepoURL   string `json:"repo_url"`
	Name      string `json:"name"`
	ScannedAt string `json:"scanned_at"`
}

// Save writes the map, replacing whatever was stored for the same repository URL.
func (s *Store) Save(res *scan.Result, repoMap *analysis.Map) error {
	mapJSON, err := json.Marshal(repoMap)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	scanned := res.ScannedAt.UTC().Format("2006-01-02T15:04:05Z")
	_, err = s.db.Exec(`
		INSERT INTO analyses (repo_url, name, commit_hash, scanned_at, map_json, map_version, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(repo_url) DO UPDATE SET
			name = excluded.name,
			commit_hash = excluded.commit_hash,
			scanned_at = excluded.scanned_at,
			map_json = excluded.map_json,
			map_version = excluded.map_version,
			updated_at = excluded.updated_at`,
		res.RepositoryURL, repoMap.Project.Name, res.Commit, scanned, string(mapJSON),
		analysis.CurrentMapVersion, now, now,
	)
	if err != nil {
		return fmt.Errorf("upsert analysis: %w", err)
	}
	return nil
}

// List returns every stored analysis, newest first.
func (s *Store) List() ([]Summary, error) {
	rows, err := s.db.Query(`SELECT id, repo_url, name, scanned_at FROM analyses ORDER BY scanned_at DESC`)
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

// Delete removes one stored analysis. Returns false when the id is missing.
func (s *Store) Delete(id int64) (bool, error) {
	res, err := s.db.Exec("DELETE FROM analyses WHERE id = ?", id)
	if err != nil {
		return false, fmt.Errorf("delete analysis: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// Get returns the stored map for one analysis, or (nil, nil) when missing.
func (s *Store) Get(id int64) (*analysis.Map, error) {
	var mapJSON string
	var mapVersion int
	err := s.db.QueryRow(`SELECT map_json, map_version FROM analyses WHERE id = ?`, id).Scan(&mapJSON, &mapVersion)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	m, err := analysis.DecodeMapJSON(mapJSON, mapVersion)
	if err != nil {
		return nil, fmt.Errorf("stored map for id %d: %w", id, err)
	}
	return m, nil
}

// Find returns the stored commit and map for one repository URL, or
// ("", nil, nil) when the repo has never been analyzed.
func (s *Store) Find(repoURL string) (commit string, repoMap *analysis.Map, err error) {
	var mapJSON string
	var mapVersion int
	err = s.db.QueryRow(
		`SELECT commit_hash, map_json, map_version FROM analyses WHERE repo_url = ?`,
		repoURL,
	).Scan(&commit, &mapJSON, &mapVersion)
	if err == sql.ErrNoRows {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, err
	}
	repoMap, err = analysis.DecodeMapJSON(mapJSON, mapVersion)
	if err != nil {
		return "", nil, fmt.Errorf("stored map for %s: %w", repoURL, err)
	}
	return commit, repoMap, nil
}

// Package-level helpers open the DB for one operation (CLI / simple callers).

// Save writes the map to dbPath, replacing the row for the same repository URL.
func Save(dbPath string, res *scan.Result, repoMap *analysis.Map) error {
	return withStore(dbPath, func(s *Store) error { return s.Save(res, repoMap) })
}

// List returns every stored analysis from dbPath, newest first.
func List(dbPath string) ([]Summary, error) {
	var out []Summary
	err := withStore(dbPath, func(s *Store) error {
		var e error
		out, e = s.List()
		return e
	})
	return out, err
}

// Delete removes one stored analysis from dbPath.
func Delete(dbPath string, id int64) (bool, error) {
	var ok bool
	err := withStore(dbPath, func(s *Store) error {
		var e error
		ok, e = s.Delete(id)
		return e
	})
	return ok, err
}

// Get returns the stored map for one analysis id from dbPath.
func Get(dbPath string, id int64) (*analysis.Map, error) {
	var m *analysis.Map
	err := withStore(dbPath, func(s *Store) error {
		var e error
		m, e = s.Get(id)
		return e
	})
	return m, err
}

// Find returns the stored commit and map for one repository URL from dbPath.
func Find(dbPath, repoURL string) (string, *analysis.Map, error) {
	var commit string
	var m *analysis.Map
	err := withStore(dbPath, func(s *Store) error {
		var e error
		commit, m, e = s.Find(repoURL)
		return e
	})
	return commit, m, err
}
