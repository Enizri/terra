package graph

import (
	"fmt"
	"path"
	"strings"

	"github.com/Enizri/terra/internal/scan"
)

// FromScan builds a provisional architecture map from scan facts alone — no LLM.
// The UI can paint this as soon as the tarball scan finishes; the final
// analyzer map replaces it on done.
func FromScan(res *scan.Result) *Map {
	dirs := res.Stats.TopLevelDirs
	components := make([]Component, 0, len(dirs)+1)
	if len(dirs) == 0 {
		components = append(components, Component{
			ID:         "repo",
			Name:       titleCase(res.Name),
			Purpose:    fmt.Sprintf("Source tree for %s (%d files).", res.Name, res.Stats.SourceFiles),
			Importance: "critical",
			Type:       guessRepoType(res),
			Tech:       primaryTech(res),
			Files:      sampleFiles(res.Files, "", 24),
			FileCount:  res.Stats.SourceFiles,
		})
	} else {
		// Rank by file count for importance.
		counts := map[string]int{}
		for _, d := range res.Tree {
			counts[d.Path] = d.Files
		}
		for _, dir := range dirs {
			n := counts[dir]
			if n == 0 {
				n = countPrefixed(res.Files, dir+"/")
			}
			components = append(components, Component{
				ID:         sanitizeID(dir),
				Name:       titleCase(dir),
				Purpose:    fmt.Sprintf("Top-level %s/ — %d source files.", dir, n),
				Importance: importanceFor(n, res.Stats.SourceFiles),
				Type:       guessDirType(dir, res),
				Tech:       dirTech(dir, res),
				Files:      sampleFiles(res.Files, dir+"/", 24),
				FileCount:  n,
			})
		}
	}

	return &Map{
		Project: Project{
			Name:             titleCase(res.Name),
			RepositoryURL:    res.RepositoryURL,
			Description:      "Structural map — Terra is still reading the architecture",
			Kind:             "structural",
			PrimaryLanguages: res.PrimaryLanguages,
			Stats: ProjectStats{
				ApproxSourceFiles: res.Stats.SourceFiles,
				TopLevelDirs:      res.Stats.TopLevelDirs,
			},
		},
		Components:         components,
		Relationships:      structuralRels(components, res),
		SuggestedQuestions: nil,
	}
}

func sanitizeID(dir string) string {
	id := strings.ToLower(strings.ReplaceAll(dir, " ", "-"))
	id = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			return r
		}
		return '-'
	}, id)
	if id == "" {
		return "dir"
	}
	return id
}

func guessRepoType(res *scan.Result) string {
	for _, lang := range res.PrimaryLanguages {
		switch strings.ToLower(lang) {
		case "typescript", "javascript", "tsx", "jsx":
			return "frontend"
		}
	}
	return "backend"
}

func guessDirType(dir string, res *scan.Result) string {
	d := strings.ToLower(dir)
	switch d {
	case "web", "frontend", "ui", "client", "app", "apps", "www", "site":
		return "frontend"
	case "api", "server", "backend", "cmd", "internal", "pkg", "service", "services", "src":
		return "backend"
	case "db", "data", "store", "storage", "prisma", "migrations", "sql":
		return "database"
	case "deploy", "infra", "infrastructure", "ops", "k8s", "kubernetes", "terraform", "docker", "charts", "helm":
		return "infrastructure"
	}
	// Manifests under this dir tip the scale.
	for _, m := range res.Dependencies {
		if m.Manifest == dir+"/"+path.Base(m.Manifest) || strings.HasPrefix(m.Manifest, dir+"/") {
			switch m.Ecosystem {
			case "npm":
				return "frontend"
			case "go", "pip":
				return "backend"
			}
		}
	}
	for _, t := range res.Tree {
		if t.Path != dir {
			continue
		}
		for _, lang := range t.Languages {
			switch strings.ToLower(lang) {
			case "typescript", "javascript", "tsx", "jsx", "css", "html":
				return "frontend"
			case "go", "python", "rust", "java", "ruby":
				return "backend"
			case "sql":
				return "database"
			}
		}
	}
	return guessRepoType(res)
}

func primaryTech(res *scan.Result) []string {
	out := make([]string, 0, len(res.PrimaryLanguages))
	out = append(out, res.PrimaryLanguages...)
	return out
}

func dirTech(dir string, res *scan.Result) []string {
	for _, t := range res.Tree {
		if t.Path == dir && len(t.Languages) > 0 {
			return append([]string{}, t.Languages...)
		}
	}
	return primaryTech(res)
}

func importanceFor(files, total int) string {
	if total <= 0 || files*2 >= total {
		return "critical"
	}
	if files*5 >= total {
		return "high"
	}
	return "medium"
}

func countPrefixed(files []string, prefix string) int {
	n := 0
	for _, f := range files {
		if strings.HasPrefix(f, prefix) {
			n++
		}
	}
	return n
}

func sampleFiles(files []string, prefix string, limit int) []string {
	out := make([]string, 0, limit)
	for _, f := range files {
		if prefix != "" && !strings.HasPrefix(f, prefix) {
			continue
		}
		out = append(out, f)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// structuralRels links an obvious frontend → backend pair when both exist.
func structuralRels(components []Component, res *scan.Result) []Relationship {
	var front, back string
	for _, c := range components {
		switch c.Type {
		case "frontend":
			if front == "" {
				front = c.ID
			}
		case "backend":
			if back == "" {
				back = c.ID
			}
		}
	}
	if front == "" || back == "" {
		return nil
	}
	because := []string{}
	hasNPM, hasGo := false, false
	for _, m := range res.Dependencies {
		switch m.Ecosystem {
		case "npm":
			hasNPM = true
		case "go":
			hasGo = true
		}
	}
	if hasNPM && hasGo {
		because = append(because, "package.json and go.mod both present")
	} else {
		because = append(because, "top-level frontend and backend directories")
	}
	return []Relationship{{
		From:    front,
		To:      back,
		Type:    "calls",
		Because: because,
	}}
}
