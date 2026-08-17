package analysis

import (
	"strings"
	"unicode"

	"github.com/Enizri/terra/internal/scan"
)

// Draft is the analyzer judgement portion before merge with scan facts.
type Draft struct {
	Description        string
	Kind               string
	Components         []Component
	Relationships      []Relationship
	SuggestedQuestions []string
}

// Assemble merges scan facts with the analyzer draft into a stored Map.
func Assemble(res *scan.Result, draft Draft) *Map {
	return &Map{
		Project: Project{
			Name:             TitleCase(res.Name),
			RepositoryURL:    res.RepositoryURL,
			Description:      strings.TrimSpace(draft.Description),
			Kind:             strings.TrimSpace(draft.Kind),
			PrimaryLanguages: res.PrimaryLanguages,
			Stats: ProjectStats{
				ApproxSourceFiles: res.Stats.SourceFiles,
				TopLevelDirs:      res.Stats.TopLevelDirs,
			},
		},
		Components:         draft.Components,
		Relationships:      draft.Relationships,
		SuggestedQuestions: draft.SuggestedQuestions,
	}
}

// TitleCase uppercases the first rune of name.
func TitleCase(name string) string {
	runes := []rune(name)
	if len(runes) == 0 {
		return name
	}
	runes[0] = unicode.ToUpper(runes[0])
	return string(runes)
}
