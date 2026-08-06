// Package graph defines the architecture map types and analyzer client.
package graph

// Map is the architecture map wire type shared with the frontend.
type Map struct {
	Project            Project        `json:"project"`
	Components         []Component    `json:"components"`
	Relationships      []Relationship `json:"relationships"`
	SuggestedQuestions []string       `json:"suggested_questions"`
}

type Project struct {
	Name             string       `json:"name"`
	RepositoryURL    string       `json:"repository_url"`
	Description      string       `json:"description"`
	Kind             string       `json:"kind"`
	PrimaryLanguages []string     `json:"primary_languages"`
	Stats            ProjectStats `json:"stats"`
}

type ProjectStats struct {
	ApproxSourceFiles int      `json:"approx_source_files"`
	TopLevelDirs      []string `json:"top_level_dirs"`
}

type Component struct {
	ID string `json:"id"`
	// ParentID is nil for top-level; empty string from the model normalizes to nil.
	ParentID   *string  `json:"parent_id"`
	Name       string   `json:"name"`
	Purpose    string   `json:"purpose"`
	Importance string   `json:"importance"`
	Type       string   `json:"type"`
	Tech       []string `json:"tech,omitempty"`
	Files      []string `json:"files"`
	FileCount  int      `json:"file_count,omitempty"`
}

type Relationship struct {
	From    string   `json:"from"`
	To      string   `json:"to"`
	Type    string   `json:"type"`
	Because []string `json:"because"`
}

// Enums and JSON schema live in analyzer/terra_analyzer/schema.py.
