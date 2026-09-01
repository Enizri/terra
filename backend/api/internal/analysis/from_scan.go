package analysis

import (
	"fmt"
	"path"
	"strings"

	"github.com/Enizri/terra/backend/api/internal/scan"
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
			Name:       TitleCase(res.Name),
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
				Name:       TitleCase(dir),
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
			Name:             TitleCase(res.Name),
			RepositoryURL:    res.RepositoryURL,
			Description:      "Structural map — Terra is still reading the architecture",
			Kind:             "structural",
			PrimaryLanguages: orEmpty(res.PrimaryLanguages),
			Stats: ProjectStats{
				ApproxSourceFiles: res.Stats.SourceFiles,
				TopLevelDirs:      orEmpty(res.Stats.TopLevelDirs),
			},
		},
		Components:         components,
		Relationships:      structuralRels(components, res),
		SuggestedQuestions: []string{},
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

// orEmpty keeps nil slices out of the JSON — the frontend types are non-nullable.
func orEmpty(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

var importanceRank = map[string]int{"critical": 0, "high": 1, "medium": 2, "low": 3}

func rankOf(importance string) int {
	if r, ok := importanceRank[importance]; ok {
		return r
	}
	return len(importanceRank)
}

// structuralRels wires every component to a hub so no block is drawn orphaned:
// the core is the most important backend (else infrastructure) block, and
// frontend/database/infrastructure/sibling blocks hang off it.
func structuralRels(components []Component, res *scan.Result) []Relationship {
	rels := []Relationship{}
	core := pickCore(components)
	if core == nil {
		return rels
	}
	dirs := dirByID(res)
	seen := map[string]bool{}
	add := func(from, to string, verb string, because []string) {
		if from == to || len(rels) >= 18 {
			return
		}
		key := from + "|" + to
		if seen[key] {
			return
		}
		seen[key] = true
		rels = append(rels, Relationship{From: from, To: to, Type: verb, Because: because})
	}

	// Typed edges first so the 18-edge cap only ever truncates the
	// sibling tail — connectivity is guaranteed up to 18 non-core components.
	for _, c := range components {
		switch c.Type {
		case "frontend":
			// Only call it a frontend→backend hop when the core really is backend.
			if core.Type == "backend" {
				add(c.ID, core.ID, "calls", manifestBecause(res))
			} else {
				add(c.ID, core.ID, "uses", siblingBecause(c, dirs[c.ID], *core, dirs[core.ID]))
			}
		case "database":
			add(core.ID, c.ID, "reads_writes", dirBecause(c, dirs[c.ID], res))
		case "infrastructure":
			add(c.ID, core.ID, "hosts", dirBecause(c, dirs[c.ID], res))
		}
	}
	for _, c := range components {
		if c.Type == "backend" {
			add(c.ID, core.ID, "uses", siblingBecause(c, dirs[c.ID], *core, dirs[core.ID]))
		}
	}
	return rels
}

// pickCore returns the hub: the best-ranked backend, else infrastructure, else
// the largest component of any type.
func pickCore(components []Component) *Component {
	better := func(a, b *Component) bool {
		if rankOf(a.Importance) != rankOf(b.Importance) {
			return rankOf(a.Importance) < rankOf(b.Importance)
		}
		return a.FileCount > b.FileCount
	}
	for _, want := range []string{"backend", "infrastructure"} {
		var best *Component
		for i, c := range components {
			if c.Type == want && (best == nil || better(&components[i], best)) {
				best = &components[i]
			}
		}
		if best != nil {
			return best
		}
	}
	var largest *Component
	for i := range components {
		if largest == nil || components[i].FileCount > largest.FileCount {
			largest = &components[i]
		}
	}
	return largest
}

func dirByID(res *scan.Result) map[string]string {
	out := map[string]string{}
	for _, d := range res.Stats.TopLevelDirs {
		out[sanitizeID(d)] = d
	}
	return out
}

func manifestBecause(res *scan.Result) []string {
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
		return []string{"package.json and go.mod both present"}
	}
	return []string{"top-level frontend and backend directories"}
}

// dirBecause cites only scan facts: the directory, a manifest under it, its languages.
func dirBecause(c Component, dir string, res *scan.Result) []string {
	if dir == "" {
		dir = c.ID
	}
	because := []string{fmt.Sprintf("top-level %s/ — %d source files", dir, c.FileCount)}
	for _, m := range res.Dependencies {
		if strings.HasPrefix(m.Manifest, dir+"/") {
			because = append(because, fmt.Sprintf("%s (%s)", m.Manifest, m.Ecosystem))
			break
		}
	}
	if len(c.Tech) > 0 && len(because) < 3 {
		because = append(because, fmt.Sprintf("%s sources under %s/", strings.Join(c.Tech, ", "), dir))
	}
	return because
}

func siblingBecause(c Component, dir string, core Component, coreDir string) []string {
	if dir == "" {
		dir = c.ID
	}
	if coreDir == "" {
		coreDir = core.ID
	}
	because := []string{fmt.Sprintf("top-level %s/ in the same source tree", dir)}
	if shared := sharedTech(c.Tech, core.Tech); shared != "" {
		because = append(because, fmt.Sprintf("%s in both %s/ and %s/", shared, dir, coreDir))
	}
	return because
}

func sharedTech(a, b []string) string {
	for _, x := range a {
		for _, y := range b {
			if strings.EqualFold(x, y) {
				return x
			}
		}
	}
	return ""
}
