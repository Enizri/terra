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
	// Ecosystem is npm, go, pip, pub, cargo, gradle, cocoapods, bundler, composer, or maven.
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
	"pubspec.yaml":     {"pub", parsePubspec},
	"Cargo.toml":       {"cargo", parseCargoTOML},
	"build.gradle":     {"gradle", parseGradle},
	"build.gradle.kts": {"gradle", parseGradle},
	"Podfile":          {"cocoapods", parsePodfile},
	"Gemfile":          {"bundler", parseGemfile},
	"composer.json":    {"composer", parseComposerJSON},
	"pom.xml":          {"maven", parsePOM},
}

// parseManifest returns nil if base is not a known manifest or parsing fails.
func parseManifest(base, relPath string, data []byte) *Manifest {
	parser, ok := manifestParsers[base]
	if !ok {
		return nil
	}
	names := parser.parse(data)
	if len(names) == 0 {
		return nil
	}
	sort.Strings(names)
	return &Manifest{Manifest: relPath, Ecosystem: parser.ecosystem, Names: names}
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

// parsePyproject reads [project] / [tool.poetry.dependencies] without a TOML parser.
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
			for _, match := range regexp.MustCompile(`"([^"]+)"`).FindAllStringSubmatch(line, -1) {
				if name := pipNameRe.FindString(match[1]); name != "" {
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

// parsePubspec reads dependencies: / dev_dependencies: keys without a YAML parser.
func parsePubspec(data []byte) []string {
	var names []string
	inDeps := false
	depIndent := -1
	for _, raw := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(raw) == "" || strings.HasPrefix(strings.TrimSpace(raw), "#") {
			continue
		}
		indent := len(raw) - len(strings.TrimLeft(raw, " \t"))
		line := strings.TrimSpace(raw)
		if indent == 0 && strings.HasSuffix(line, ":") && !strings.Contains(line, " ") {
			key := strings.TrimSuffix(line, ":")
			inDeps = key == "dependencies" || key == "dev_dependencies"
			depIndent = -1
			continue
		}
		if !inDeps {
			continue
		}
		if depIndent < 0 {
			depIndent = indent
		}
		if indent < depIndent {
			inDeps = false
			continue
		}
		if indent != depIndent {
			continue
		}
		name, _, _ := strings.Cut(line, ":")
		name = strings.TrimSpace(name)
		if name != "" {
			names = append(names, name)
		}
	}
	return names
}

func parseCargoTOML(data []byte) []string {
	want := map[string]bool{
		"dependencies":           true,
		"dev-dependencies":       true,
		"build-dependencies":     true,
		"workspace.dependencies": true,
	}
	var names []string
	section := ""
	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") {
			section = strings.Trim(line, "[]")
			continue
		}
		if !want[section] {
			continue
		}
		name, _, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		name = strings.Trim(strings.TrimSpace(name), `"`)
		if name != "" && !strings.HasPrefix(name, "#") {
			names = append(names, name)
		}
	}
	return names
}

var gradleDepRe = regexp.MustCompile(`(?i)(?:implementation|api|compileOnly|runtimeOnly|kapt|ksp|annotationProcessor|compile|testImplementation|androidTestImplementation|debugImplementation)\s*\(?['"]([^'"]+)['"]`)

func parseGradle(data []byte) []string {
	var names []string
	seen := map[string]bool{}
	for _, match := range gradleDepRe.FindAllStringSubmatch(string(data), -1) {
		coord := match[1]
		parts := strings.Split(coord, ":")
		if len(parts) >= 2 {
			coord = parts[0] + ":" + parts[1]
		}
		if coord != "" && !seen[coord] {
			seen[coord] = true
			names = append(names, coord)
		}
	}
	return names
}

var podRe = regexp.MustCompile(`(?i)^\s*pod\s+['"]([^'"]+)['"]`)

func parsePodfile(data []byte) []string {
	var names []string
	for _, line := range strings.Split(string(data), "\n") {
		if match := podRe.FindStringSubmatch(line); match != nil {
			names = append(names, match[1])
		}
	}
	return names
}

var gemRe = regexp.MustCompile(`(?i)^\s*gem\s+['"]([^'"]+)['"]`)

func parseGemfile(data []byte) []string {
	var names []string
	for _, line := range strings.Split(string(data), "\n") {
		if match := gemRe.FindStringSubmatch(line); match != nil {
			names = append(names, match[1])
		}
	}
	return names
}

func parseComposerJSON(data []byte) []string {
	var pkg struct {
		Require    map[string]string `json:"require"`
		RequireDev map[string]string `json:"require-dev"`
	}
	if json.Unmarshal(data, &pkg) != nil {
		return nil
	}
	seen := map[string]bool{}
	var names []string
	add := func(name string) {
		if name == "" || name == "php" || strings.HasPrefix(name, "ext-") || seen[name] {
			return
		}
		seen[name] = true
		names = append(names, name)
	}
	for name := range pkg.Require {
		add(name)
	}
	for name := range pkg.RequireDev {
		add(name)
	}
	return names
}

func parsePOM(data []byte) []string {
	s := string(data)
	var names []string
	seen := map[string]bool{}
	for {
		start := strings.Index(s, "<dependency>")
		if start < 0 {
			break
		}
		rest := s[start+len("<dependency>"):]
		end := strings.Index(rest, "</dependency>")
		if end < 0 {
			break
		}
		block := rest[:end]
		s = rest[end+len("</dependency>"):]
		i := strings.Index(block, "<artifactId>")
		if i < 0 {
			continue
		}
		rest2 := block[i+len("<artifactId>"):]
		j := strings.Index(rest2, "</artifactId>")
		if j < 0 {
			continue
		}
		name := strings.TrimSpace(rest2[:j])
		if name != "" && !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	return names
}
