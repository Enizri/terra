package scan

import (
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Result struct {
	SchemaVersion    int            `json:"schema_version"`
	RepositoryURL    string         `json:"repository_url"`
	Name             string         `json:"name"`
	Commit           string         `json:"commit"`
	ScannedAt        time.Time      `json:"scanned_at"`
	Stats            Stats          `json:"stats"`
	Languages        []LanguageStat `json:"languages"`
	PrimaryLanguages []string       `json:"primary_languages"`
	Tree             []DirSummary   `json:"tree"`
	Dependencies     []Manifest     `json:"dependencies"`
	// Files are repo-relative source paths, capped at maxFiles; FilesNote is
	// set when that cap kicked in. Dirs is every directory containing source,
	// uncapped — it stays small and is what path claims get checked against.
	Files     []string `json:"files"`
	FilesNote string   `json:"files_note,omitempty"`
	Dirs      []string `json:"dirs"`
}

// maxFiles caps the path list; past it we keep a per-directory sample so the
// shape of the tree survives even when the file count doesn't.
const maxFiles = 4000

type Stats struct {
	SourceFiles  int      `json:"source_files"`
	TotalBytes   int64    `json:"total_bytes"`
	TopLevelDirs []string `json:"top_level_dirs"`
}

type LanguageStat struct {
	Name  string `json:"name"`
	Files int    `json:"files"`
	Bytes int64  `json:"bytes"`
}

type DirSummary struct {
	Path      string   `json:"path"`
	Files     int      `json:"files"`
	Languages []string `json:"languages"`
}

var skipDirs = map[string]bool{
	"node_modules": true,
	"vendor":       true,
	"dist":         true,
	"build":        true,
	"target":       true,
}

// Scan clones the GitHub repo at rawURL into a temp dir, analyzes it, and
// cleans up the clone.
func Scan(rawURL string) (*Result, error) {
	url, name, err := NormalizeURL(rawURL)
	if err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp("", "terra-scan-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)

	commit, err := clone(url, dir)
	if err != nil {
		return nil, err
	}

	res := &Result{
		SchemaVersion: 1,
		RepositoryURL: url,
		Name:          name,
		Commit:        commit,
		ScannedAt:     time.Now().UTC(),
	}
	if err := walkRepo(dir, res); err != nil {
		return nil, err
	}
	return res, nil
}

func walkRepo(root string, res *Result) error {
	langFiles := map[string]int{}
	langBytes := map[string]int64{}
	dirFiles := map[string]int{}
	dirLangBytes := map[string]map[string]int64{}
	dirSet := map[string]bool{}
	var allFiles []string

	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		if d.IsDir() {
			if rel != "." && (strings.HasPrefix(d.Name(), ".") || skipDirs[d.Name()]) {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(d.Name(), ".") {
			return nil
		}

		if m := parseManifest(d.Name(), path, filepath.ToSlash(rel)); m != nil {
			res.Dependencies = append(res.Dependencies, *m)
		}

		lang, ok := extToLanguage[strings.ToLower(filepath.Ext(d.Name()))]
		if !ok {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		langFiles[lang]++
		langBytes[lang] += info.Size()
		res.Stats.SourceFiles++
		res.Stats.TotalBytes += info.Size()

		allFiles = append(allFiles, filepath.ToSlash(rel))

		if top, _, hasDir := strings.Cut(filepath.ToSlash(rel), "/"); hasDir {
			dirFiles[top]++
			if dirLangBytes[top] == nil {
				dirLangBytes[top] = map[string]int64{}
			}
			dirLangBytes[top][lang] += info.Size()
		}
		return nil
	})
	if err != nil {
		return err
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() && !strings.HasPrefix(e.Name(), ".") && !skipDirs[e.Name()] {
			res.Stats.TopLevelDirs = append(res.Stats.TopLevelDirs, e.Name())
		}
	}
	sort.Strings(res.Stats.TopLevelDirs)

	for lang, n := range langFiles {
		res.Languages = append(res.Languages, LanguageStat{Name: lang, Files: n, Bytes: langBytes[lang]})
	}
	sort.Slice(res.Languages, func(i, j int) bool { return res.Languages[i].Bytes > res.Languages[j].Bytes })

	// Primary = every language holding at least 10% of source bytes.
	for _, l := range res.Languages {
		if res.Stats.TotalBytes > 0 && l.Bytes*10 >= res.Stats.TotalBytes {
			res.PrimaryLanguages = append(res.PrimaryLanguages, l.Name)
		}
	}

	for dir, n := range dirFiles {
		res.Tree = append(res.Tree, DirSummary{Path: dir, Files: n, Languages: sortedByBytes(dirLangBytes[dir])})
	}
	sort.Slice(res.Tree, func(i, j int) bool { return res.Tree[i].Files > res.Tree[j].Files })
	sort.Slice(res.Dependencies, func(i, j int) bool { return res.Dependencies[i].Manifest < res.Dependencies[j].Manifest })

	for _, f := range allFiles {
		for d := path.Dir(f); d != "." && d != "/"; d = path.Dir(d) {
			dirSet[d] = true
		}
	}
	for d := range dirSet {
		res.Dirs = append(res.Dirs, d)
	}
	sort.Strings(res.Dirs)
	sort.Strings(allFiles)
	res.Files, res.FilesNote = SamplePaths(allFiles, maxFiles)
	return nil
}

// SamplePaths returns all paths when there are few enough, otherwise an even
// per-directory sample so every part of the tree stays represented, plus a
// note describing what was left out.
func SamplePaths(all []string, maxFiles int) (files []string, note string) {
	if len(all) <= maxFiles {
		return all, ""
	}
	byDir := map[string][]string{}
	for _, p := range all {
		d := path.Dir(p)
		byDir[d] = append(byDir[d], p)
	}
	per := maxFiles / len(byDir)
	if per < 1 {
		per = 1
	}
	for _, group := range byDir {
		if len(group) > per {
			group = group[:per]
		}
		files = append(files, group...)
	}
	sort.Strings(files)
	if len(files) > maxFiles {
		files = files[:maxFiles]
	}
	return files, fmt.Sprintf("showing %d of %d source files (up to %d per directory)", len(files), len(all), per)
}

func sortedByBytes(byLang map[string]int64) []string {
	langs := make([]string, 0, len(byLang))
	for l := range byLang {
		langs = append(langs, l)
	}
	sort.Slice(langs, func(i, j int) bool { return byLang[langs[i]] > byLang[langs[j]] })
	return langs
}
