// Package store persists architecture maps in a local SQLite file.
// Maps live in analyses.map_json; components/relationships are not normalized
// until a real query need appears (see docs/architecture/data.md).
package store

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite" // pure-Go driver, registered as "sqlite"
)

// Store is an open SQLite connection with migrations already applied.
type Store struct {
	db   *sql.DB
	path string
}

// Open opens dbPath with WAL + busy_timeout, runs migrations, and returns a Store.
func Open(dbPath string) (*Store, error) {
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
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db, path: dbPath}, nil
}

// Close releases the database handle.
func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

// withStore opens path, runs fn, and closes. Used by package-level helpers.
func withStore(dbPath string, fn func(*Store) error) error {
	s, err := Open(dbPath)
	if err != nil {
		return err
	}
	defer s.Close()
	return fn(s)
}
