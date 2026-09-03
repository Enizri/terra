package preview

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var defaultAPIRoutes = []string{
	"/", "/healthz", "/health", "/ready", "/openapi.json", "/swagger.json", "/docs",
}

var goRoute = regexp.MustCompile(`(?m)(?:HandleFunc|Handle|GET|POST|PUT|DELETE|PATCH)\(\s*"(/[A-Za-z0-9_./{}.-]*)"`)

const maxDiscoveredRoutes = 24
const maxRouteFiles = 200

// DiscoverRoutes is the seed list for the API console: static probes plus
// quoted paths in Go Handle/GET calls. No LLM.
func DiscoverRoutes(root string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(p string) {
		p = strings.TrimSpace(p)
		if p == "" || seen[p] || len(out) >= maxDiscoveredRoutes {
			return
		}
		if _, err := SafeAPIPath(p); err != nil {
			return
		}
		seen[p] = true
		out = append(out, p)
	}
	for _, p := range defaultAPIRoutes {
		add(p)
	}
	n := 0
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || n >= maxRouteFiles {
			return err
		}
		if d.IsDir() {
			name := d.Name()
			if name == "node_modules" || name == "vendor" || name == ".git" || name == "dist" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		n++
		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		for _, m := range goRoute.FindAllSubmatch(data, 12) {
			add(string(m[1]))
		}
		return nil
	})
	return out
}
