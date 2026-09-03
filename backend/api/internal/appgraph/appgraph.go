// Package appgraph discovers every runnable app in a checkout: web, api,
// mobile and desktop. It only looks — nothing here boots a process.
package appgraph

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Enizri/terra/backend/api/internal/runfile"
)

// Kind is what an app is, not how it is written.
type Kind string

// The four kinds a checkout can hold.
const (
	KindWeb     Kind = "web"
	KindAPI     Kind = "api"
	KindMobile  Kind = "mobile"
	KindDesktop Kind = "desktop"
)

// maxDepth is how deep below the repo root a manifest may sit and still be
// found. 3 reaches apps/web/client/package.json, which depth 2 missed.
const maxDepth = 3

// App is one runnable thing found in a checkout.
type App struct {
	ID   string `json:"id"`  // stable, URL-safe; derived from Dir and Kind
	Dir  string `json:"dir"` // repo-relative, slash-separated; "." is the root
	Kind Kind   `json:"kind"`
	// Framework names the toolchain that boots it ("vite", "next", "expo",
	// "flutter", "electron", "tauri", "go", "django", …). Launch flags per
	// framework are a separate concern; Run below stays flag-free.
	Framework string `json:"framework"`
	Install   string `json:"install,omitempty"`
	Run       string `json:"run,omitempty"` // may contain "{port}"
	Ports     []int  `json:"ports,omitempty"`
	// Previewable is false when Terra cannot boot this app on this machine.
	// Reason then carries user-facing copy explaining why.
	Previewable bool     `json:"previewable"`
	Reason      string   `json:"reason,omitempty"`
	DependsOn   []string `json:"depends_on,omitempty"`
}

// skipDirs are never walked into: build output, vendored code and SDK caches.
var skipDirs = map[string]bool{
	"node_modules": true, ".git": true, "vendor": true, "dist": true,
	"build": true, "target": true, "Pods": true, ".gradle": true,
	".dart_tool": true, "examples": true,
}

// Detect walks root and returns every app it recognises, primary first.
func Detect(root string) ([]App, error) {
	var found []App
	for _, dir := range manifestDirs(root) {
		found = append(found, fromNode(root, dir)...)
		found = append(found, fromGo(root, dir)...)
		found = append(found, fromPython(root, dir)...)
		found = append(found, fromNative(root, dir)...)
	}
	found = dropNestedPlatformDirs(found)
	if len(found) == 0 {
		return nil, fmt.Errorf("no runnable app found in %s", root)
	}
	rank(found)
	assignIDs(found)
	link(found)
	return found, nil
}

// For returns a cached or freshly detected app list. Empty sha skips the cache.
func For(root, sha string) ([]App, error) {
	var apps []App
	if sha != "" && runfile.LoadJSON("appgraph", sha, &apps) && len(apps) > 0 {
		return apps, nil
	}
	apps, err := Detect(root)
	if err != nil {
		return nil, err
	}
	if sha != "" {
		runfile.SaveJSON("appgraph", sha, apps)
	}
	return apps, nil
}

// Primary returns the app a preview should open by default, or false when
// nothing in the checkout can be booted.
func Primary(apps []App) (App, bool) {
	for _, app := range apps {
		if app.Previewable {
			return app, true
		}
	}
	return App{}, false
}

/* ---------- walk ---------- */

// manifestDirs returns every directory at depth ≤ maxDepth, root first, in a
// stable order so two runs of the same checkout agree.
func manifestDirs(root string) []string {
	var dirs []string
	filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil || !d.IsDir() {
			return nil
		}
		if path != root {
			if skipDirs[d.Name()] || strings.HasPrefix(d.Name(), ".") {
				return filepath.SkipDir
			}
		}
		if depth(root, path) > maxDepth {
			return filepath.SkipDir
		}
		dirs = append(dirs, path)
		return nil
	})
	sort.Slice(dirs, func(i, j int) bool {
		if di, dj := depth(root, dirs[i]), depth(root, dirs[j]); di != dj {
			return di < dj
		}
		return dirs[i] < dirs[j]
	})
	return dirs
}

func depth(root, path string) int {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." {
		return 0
	}
	return len(strings.Split(rel, string(filepath.Separator)))
}

func rel(root, dir string) string {
	out, err := filepath.Rel(root, dir)
	if err != nil {
		return "."
	}
	return filepath.ToSlash(out)
}

func exists(dir, name string) bool {
	_, err := os.Stat(filepath.Join(dir, filepath.FromSlash(name)))
	return err == nil
}

func glob(dir, pattern string) bool {
	matches, err := filepath.Glob(filepath.Join(dir, pattern))
	return err == nil && len(matches) > 0
}
