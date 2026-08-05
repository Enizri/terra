package scan

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func mustParse(t *testing.T, base string) []string {
	t.Helper()
	m := parseManifest(base, filepath.Join("testdata", base), base)
	if m == nil {
		t.Fatalf("parseManifest(%s) returned nil", base)
	}
	return m.Names
}

func TestParsePackageJSON(t *testing.T) {
	got := mustParse(t, "package.json")
	want := []string{"@connectrpc/connect-web", "react", "vite"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestParseGoMod(t *testing.T) {
	got := mustParse(t, "go.mod")
	want := []string{"github.com/labstack/echo/v4", "github.com/lib/pq", "google.golang.org/grpc"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v (indirect deps must be excluded)", got, want)
	}
}

func TestParseRequirements(t *testing.T) {
	got := mustParse(t, "requirements.txt")
	want := []string{"flask", "numpy", "requests"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestParsePyproject(t *testing.T) {
	got := mustParse(t, "pyproject.toml")
	want := []string{"fastapi", "httpx", "pydantic"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v (python itself must be excluded)", got, want)
	}
}

func TestNormalizeURL(t *testing.T) {
	cases := []struct {
		in, url, name string
		wantErr       bool
	}{
		{in: "https://github.com/usememos/memos", url: "https://github.com/usememos/memos", name: "memos"},
		{in: "https://github.com/usememos/memos.git", url: "https://github.com/usememos/memos", name: "memos"},
		{in: "https://github.com/usememos/memos/tree/main/web", url: "https://github.com/usememos/memos", name: "memos"},
		{in: "git@github.com:usememos/memos.git", url: "https://github.com/usememos/memos", name: "memos"},
		{in: "github.com/usememos/memos", url: "https://github.com/usememos/memos", name: "memos"},
		{in: "https://gitlab.com/foo/bar", wantErr: true},
		{in: "not a url", wantErr: true},
	}
	for _, c := range cases {
		url, name, err := NormalizeURL(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("NormalizeURL(%q): expected error, got %q", c.in, url)
			}
			continue
		}
		if err != nil || url != c.url || name != c.name {
			t.Errorf("NormalizeURL(%q) = %q, %q, %v; want %q, %q", c.in, url, name, err, c.url, c.name)
		}
	}
}

func TestWalkRepoCollectsFilesAndDirs(t *testing.T) {
	root := t.TempDir()
	for _, p := range []string{"main.go", "web/src/App.tsx", "web/src/index.tsx", "node_modules/dep/x.js", ".git/config"} {
		full := filepath.Join(root, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	var res Result
	if err := walkRepo(root, &res); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(res.Files, ","); got != "main.go,web/src/App.tsx,web/src/index.tsx" {
		t.Errorf("files = %q (ignored directories must stay ignored)", got)
	}
	if got := strings.Join(res.Dirs, ","); got != "web,web/src" {
		t.Errorf("dirs = %q, want every ancestor of a source file", got)
	}
	if res.FilesNote != "" {
		t.Errorf("small repositories should not be truncated, got note %q", res.FilesNote)
	}
}

func TestSamplePaths(t *testing.T) {
	var all []string
	for i := 0; i < 10; i++ {
		for j := 0; j < 50; j++ {
			all = append(all, fmt.Sprintf("pkg%d/file%02d.go", i, j))
		}
	}
	files, note := SamplePaths(all, 500)
	if len(files) != 500 || note != "" {
		t.Errorf("nothing to drop: got %d files, note %q", len(files), note)
	}

	files, note = SamplePaths(all, 100)
	if len(files) > 100 {
		t.Errorf("got %d files, cap was 100", len(files))
	}
	if note == "" {
		t.Error("a truncated list must carry a note")
	}
	seen := map[string]bool{}
	for _, f := range files {
		seen[path.Dir(f)] = true
	}
	if len(seen) != 10 {
		t.Errorf("sample covers %d of 10 directories; every directory should survive", len(seen))
	}
}

func TestLanguageMap(t *testing.T) {
	for ext, want := range map[string]string{".go": "Go", ".tsx": "TypeScript", ".proto": "Protocol Buffers"} {
		if got := extToLanguage[ext]; got != want {
			t.Errorf("extToLanguage[%s] = %q, want %q", ext, got, want)
		}
	}
	if _, ok := extToLanguage[".md"]; ok {
		t.Error("markdown must not count as a source language")
	}
}
