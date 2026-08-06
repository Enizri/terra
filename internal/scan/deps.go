package scan

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
)

// Manifest is one dependency file found in the tree.
type Manifest struct {
	// Manifest is the repo-relative path to the file.
	Manifest string `json:"manifest"`
	// Ecosystem is npm, go, or pip.
	Ecosystem string   `json:"ecosystem"`
	Names     []string `json:"names"`
}

var manifestParsers = map[string]struct {
	ecosystem string
	parse     func([]byte) []string
}{
	"package.json":     {"npm", parsePackageJSON},
	"go.mod":           {"go", parseGoMod},
	"requirements.txt": {"pip", parseRequirements},
	"pyproject.toml":   {"pip", parsePyproject},
}

// parseManifest returns nil if base is not a known manifest or parsing fails.
func parseManifest(base, relPath string, data []byte) *Manifest {
	p, ok := manifestParsers[base]
	if !ok {
		return nil
	}
	names := p.parse(data)
	if len(names) == 0 {
		return nil
	}
	sort.Strings(names)
	return &Manifest{Manifest: relPath, Ecosystem: p.ecosystem, Names: names}
}

func parsePackageJSON(data []byte) []string {
	var pkg struct {
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
	}
	if json.Unmarshal(data, &pkg) != nil {
		return nil
	}
	seen := map[string]bool{}
	var names []string
	for name := range pkg.Dependencies {
		if !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	for name := range pkg.DevDependencies {
		if !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	return names
}

func parseGoMod(data []byte) []string {
	var names []string
	inBlock := false
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		switch {
		case line == "require (":
			inBlock = true
		case inBlock && line == ")":
			inBlock = false
		case inBlock || strings.HasPrefix(line, "require "):
			if strings.Contains(line, "// indirect") {
				continue
			}
			fields := strings.Fields(strings.TrimPrefix(line, "require "))
			if len(fields) >= 2 && !strings.HasPrefix(fields[0], "//") {
				names = append(names, fields[0])
			}
		}
	}
	return names
}

var pipNameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*`)

func parseRequirements(data []byte) []string {
	var names []string
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "-") {
			continue
		}
		if name := pipNameRe.FindString(line); name != "" {
			names = append(names, name)
		}
	}
	return names
}

// parsePyproject handles [project] dependencies arrays and
// [tool.poetry.dependencies] tables without a TOML dependency.
// ponytail: line-based scan, add a TOML parser if real repos break it.
func parsePyproject(data []byte) []string {
	var names []string
	section := ""
	inDepsArray := false
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "[") {
			section = strings.Trim(line, "[]")
			inDepsArray = false
			continue
		}
		switch {
		case section == "project" && strings.HasPrefix(line, "dependencies"):
			inDepsArray = true
			fallthrough
		case section == "project" && inDepsArray:
			for _, m := range regexp.MustCompile(`"([^"]+)"`).FindAllStringSubmatch(line, -1) {
				if name := pipNameRe.FindString(m[1]); name != "" {
					names = append(names, name)
				}
			}
			if strings.Contains(line, "]") {
				inDepsArray = false
			}
		case section == "tool.poetry.dependencies":
			name, _, ok := strings.Cut(line, "=")
			name = strings.TrimSpace(name)
			if ok && name != "" && name != "python" && !strings.HasPrefix(name, "#") {
				names = append(names, strings.Trim(name, `"`))
			}
		}
	}
	return names
}
