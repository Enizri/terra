package scan

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"path"
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

// Scan resolves the repo's HEAD commit, streams its tarball from codeload,
// and analyzes it in memory. No git, no clone, no working tree on disk.
func Scan(rawURL string) (*Result, error) {
	url, name, err := NormalizeURL(rawURL)
	if err != nil {
		return nil, err
	}
	owner, repo, _ := ownerRepo(rawURL)
	sha, err := ResolveCommit(owner, repo)
	if err != nil {
		return nil, err
	}
	body, err := fetchTarball(owner, repo, sha)
	if err != nil {
		return nil, err
	}
	defer body.Close()

	res := &Result{
		SchemaVersion: 1,
		RepositoryURL: url,
		Name:          name,
		Commit:        sha,
		ScannedAt:     time.Now().UTC(),
	}
	if err := scanTarball(body, res); err != nil {
		return nil, err
	}
	return res, nil
}

// skipPath reports whether any segment of a repo-relative path is hidden or a
// dependency/build directory — the same entries the old disk walk skipped.
func skipPath(rel string) bool {
	for _, seg := range strings.Split(rel, "/") {
		if strings.HasPrefix(seg, ".") || skipDirs[seg] {
			return true
		}
	}
	return false
}

// scanTarball fills res from a gzipped codeload tarball stream.
func scanTarball(r io.Reader, res *Result) error {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return fmt.Errorf("read tarball: %w", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	col := newCollector(res)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("read tarball: %w", err)
		}
		rel, ok := stripRoot(hdr.Name)
		if !ok || rel == "" || skipPath(rel) {
			continue
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			col.dir(rel)
		case tar.TypeReg:
			col.file(rel, hdr.Size, func() ([]byte, error) { return io.ReadAll(tr) })
		}
	}
	col.finish()
	return nil
}

// collector accumulates per-file facts and turns them into a Result. It is
// fed by scanTarball but has no opinion about where the entries come from.
type collector struct {
	res          *Result
	langFiles    map[string]int
	langBytes    map[string]int64
	dirFiles     map[string]int
	dirLangBytes map[string]map[string]int64
	topDirs      map[string]bool
	allFiles     []string
}

func newCollector(res *Result) *collector {
	return &collector{
		res:          res,
		langFiles:    map[string]int{},
		langBytes:    map[string]int64{},
		dirFiles:     map[string]int{},
		dirLangBytes: map[string]map[string]int64{},
		topDirs:      map[string]bool{},
	}
}

func (c *collector) dir(rel string) {
	if !strings.Contains(rel, "/") {
		c.topDirs[rel] = true
	}
}

// file records one regular file. read is only called for dependency
// manifests, so a tar scan doesn't buffer file bodies it never looks at.
func (c *collector) file(rel string, size int64, read func() ([]byte, error)) {
	base := path.Base(rel)
	if _, ok := manifestParsers[base]; ok {
		if data, err := read(); err == nil {
			if manifest := parseManifest(base, rel, data); manifest != nil {
				c.res.Dependencies = append(c.res.Dependencies, *manifest)
			}
		}
	}

	if top, _, nested := strings.Cut(rel, "/"); nested {
		c.topDirs[top] = true
	}

	lang, ok := extToLanguage[strings.ToLower(path.Ext(base))]
	if !ok {
		return
	}
	c.langFiles[lang]++
	c.langBytes[lang] += size
	c.res.Stats.SourceFiles++
	c.res.Stats.TotalBytes += size
	c.allFiles = append(c.allFiles, rel)

	if top, _, nested := strings.Cut(rel, "/"); nested {
		c.dirFiles[top]++
		if c.dirLangBytes[top] == nil {
			c.dirLangBytes[top] = map[string]int64{}
		}
		c.dirLangBytes[top][lang] += size
	}
}

func (c *collector) finish() {
	res := c.res
	for dir := range c.topDirs {
		res.Stats.TopLevelDirs = append(res.Stats.TopLevelDirs, dir)
	}
	sort.Strings(res.Stats.TopLevelDirs)

	for lang, nFiles := range c.langFiles {
		res.Languages = append(res.Languages, LanguageStat{Name: lang, Files: nFiles, Bytes: c.langBytes[lang]})
	}
	sort.Slice(res.Languages, func(i, j int) bool { return res.Languages[i].Bytes > res.Languages[j].Bytes })

	// Primary = every language holding at least 10% of source bytes.
	for _, lang := range res.Languages {
		if res.Stats.TotalBytes > 0 && lang.Bytes*10 >= res.Stats.TotalBytes {
			res.PrimaryLanguages = append(res.PrimaryLanguages, lang.Name)
		}
	}

	for dir, nFiles := range c.dirFiles {
		res.Tree = append(res.Tree, DirSummary{Path: dir, Files: nFiles, Languages: sortedByBytes(c.dirLangBytes[dir])})
	}
	sort.Slice(res.Tree, func(i, j int) bool { return res.Tree[i].Files > res.Tree[j].Files })
	sort.Slice(res.Dependencies, func(i, j int) bool { return res.Dependencies[i].Manifest < res.Dependencies[j].Manifest })

	dirSet := map[string]bool{}
	for _, filePath := range c.allFiles {
		for dir := path.Dir(filePath); dir != "." && dir != "/"; dir = path.Dir(dir) {
			dirSet[dir] = true
		}
	}
	for dir := range dirSet {
		res.Dirs = append(res.Dirs, dir)
	}
	sort.Strings(res.Dirs)
	sort.Strings(c.allFiles)
	res.Files, res.FilesNote = SamplePaths(c.allFiles, maxFiles)
}

// SamplePaths returns all paths when there are few enough, otherwise an even
// per-directory sample so every part of the tree stays represented, plus a
// note describing what was left out.
func SamplePaths(all []string, maxFiles int) (files []string, note string) {
	if len(all) <= maxFiles {
		return all, ""
	}
	byDir := map[string][]string{}
	for _, filePath := range all {
		dir := path.Dir(filePath)
		byDir[dir] = append(byDir[dir], filePath)
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
	for lang := range byLang {
		langs = append(langs, lang)
	}
	sort.Slice(langs, func(i, j int) bool { return byLang[langs[i]] > byLang[langs[j]] })
	return langs
}
