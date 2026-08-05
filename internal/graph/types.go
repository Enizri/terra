// Package graph turns a scan of a repository into a knowledge map: the
// handful of components a non-engineer needs to hold in their head, and how
// those components depend on each other.
package graph

// Map mirrors case-studies/memos.map.json, which is the schema contract
// between this pipeline and the frontend.
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
	// ParentID is null for a top-level component. The model is asked for an
	// empty string instead of null, which normalize turns back into null.
	// ponytail: nullable types survive Ollama's schema-to-grammar step
	// unreliably; revisit if the model ever gets bigger than 3B.
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

// The enums (importance, component type, relationship verbs) and the JSON
// schema built from them live in the Python analyzer (analyzer/terra_analyzer/
// schema.py), which is their single source of truth. Go stores and displays
// these fields as plain strings.
