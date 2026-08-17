package store

import (
	"database/sql"
	"fmt"
)

// migration is one numbered schema change, applied inside a transaction.
type migration struct {
	version int
	name    string
	up      string
}

// migrations is append-only. Never edit a shipped version; add a new one.
var migrations = []migration{
	{
		version: 1,
		name:    "create_projects",
		up: `
CREATE TABLE IF NOT EXISTS projects (
	id          INTEGER PRIMARY KEY,
	repo_url    TEXT UNIQUE NOT NULL,
	name        TEXT,
	commit_hash TEXT,
	scanned_at  TEXT,
	map_json    TEXT
);`,
	},
	{
		version: 2,
		name:    "projects_to_analyses",
		up: `
CREATE TABLE analyses (
	id          INTEGER PRIMARY KEY,
	repo_url    TEXT UNIQUE NOT NULL,
	name        TEXT,
	commit_hash TEXT,
	scanned_at  TEXT,
	map_json    TEXT NOT NULL,
	map_version INTEGER NOT NULL DEFAULT 1,
	created_at  TEXT NOT NULL,
	updated_at  TEXT NOT NULL
);
INSERT INTO analyses (id, repo_url, name, commit_hash, scanned_at, map_json, map_version, created_at, updated_at)
SELECT id, repo_url, name, commit_hash, scanned_at, COALESCE(map_json, '{}'), 1,
       COALESCE(scanned_at, datetime('now')),
       COALESCE(scanned_at, datetime('now'))
FROM projects;
DROP TABLE projects;
`,
	},
}

func migrate(db *sql.DB) error {
	if _, err := db.Exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
	version INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	// Legacy DBs created before schema_migrations: detect projects table and
	// record v1 as already applied so we only run v2+.
	if err := bootstrapLegacy(db); err != nil {
		return err
	}

	var current int
	if err := db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&current); err != nil {
		return fmt.Errorf("read schema_migrations: %w", err)
	}

	for _, m := range migrations {
		if m.version <= current {
			continue
		}
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(m.up); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d (%s): %w", m.version, m.name, err)
		}
		if _, err := tx.Exec(
			`INSERT INTO schema_migrations (version, name) VALUES (?, ?)`,
			m.version, m.name,
		); err != nil {
			tx.Rollback()
			return fmt.Errorf("record migration %d: %w", m.version, err)
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func bootstrapLegacy(db *sql.DB) error {
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	var name string
	err := db.QueryRow(
		`SELECT name FROM sqlite_master WHERE type='table' AND name='projects'`,
	).Scan(&name)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	_, err = db.Exec(
		`INSERT INTO schema_migrations (version, name) VALUES (1, 'create_projects')`,
	)
	return err
}
