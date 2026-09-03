package scan

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func mustParse(t *testing.T, base string) []string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", base))
	if err != nil {
		t.Fatal(err)
	}
	m := parseManifest(base, base, data)
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

func TestParsePubspec(t *testing.T) {
	got := mustParse(t, "pubspec.yaml")
	want := []string{"flutter", "flutter_test", "http", "provider"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestParseCargoTOML(t *testing.T) {
	got := mustParse(t, "Cargo.toml")
	want := []string{"serde", "tauri", "tokio"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestParseGradle(t *testing.T) {
	got := mustParse(t, "build.gradle")
	want := []string{"androidx.core:core-ktx", "com.google.guava:guava"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestParseGradleKts(t *testing.T) {
	got := mustParse(t, "build.gradle.kts")
	want := []string{"androidx.appcompat:appcompat", "com.google.dagger:dagger-compiler"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestParsePodfile(t *testing.T) {
	got := mustParse(t, "Podfile")
	want := []string{"Alamofire", "Firebase/Auth"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestParseGemfile(t *testing.T) {
	got := mustParse(t, "Gemfile")
	want := []string{"pg", "rails"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestParseComposerJSON(t *testing.T) {
	got := mustParse(t, "composer.json")
	want := []string{"laravel/framework", "phpunit/phpunit"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v (php and ext-* must be excluded)", got, want)
	}
}

func TestParsePOM(t *testing.T) {
	got := mustParse(t, "pom.xml")
	want := []string{"spring-boot-starter-web"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v (project artifactId must be excluded)", got, want)
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

func TestScanTarballCollectsFilesAndDirs(t *testing.T) {
	tgz := makeTarball(t, "memos-abc1234", map[string]string{
		"main.go":               "package main\n",
		"web/src/App.tsx":       "export {}\n",
		"web/src/index.tsx":     "export {}\n",
		"node_modules/dep/x.js": "x",
		".git/config":           "x",
		"docs/":                 "", // dir entry with no source files
		"go.mod":                "module x\n\nrequire github.com/lib/pq v1.0.0\n",
	})
	var res Result
	if err := scanTarball(bytes.NewReader(tgz), &res); err != nil {
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
	if got := strings.Join(res.Stats.TopLevelDirs, ","); got != "docs,web" {
		t.Errorf("top-level dirs = %q, want docs,web (hidden and dependency dirs excluded)", got)
	}
	if len(res.Dependencies) != 1 || res.Dependencies[0].Manifest != "go.mod" {
		t.Errorf("dependencies = %+v, want the go.mod manifest", res.Dependencies)
	}
	if len(res.Languages) == 0 || res.Languages[0].Name != "TypeScript" {
		t.Errorf("languages = %+v, want TypeScript first (most bytes)", res.Languages)
	}
}

func TestScanTarballFlutterParsesPubspec(t *testing.T) {
	tgz := makeTarball(t, "notes-abc", map[string]string{
		"pubspec.yaml":                        mustReadTestdata(t, "pubspec.yaml"),
		"lib/main.dart":                       "void main() {}\n",
		"ios/Runner/AppDelegate.swift":        "import UIKit\n",
		"android/app/src/main/kotlin/Main.kt": "class Main\n",
	})
	var res Result
	if err := scanTarball(bytes.NewReader(tgz), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Dependencies) != 1 || res.Dependencies[0].Ecosystem != "pub" {
		t.Fatalf("dependencies = %+v, want one pubspec", res.Dependencies)
	}
	if !reflect.DeepEqual(res.Dependencies[0].Names, []string{"flutter", "flutter_test", "http", "provider"}) {
		t.Errorf("pub names = %v", res.Dependencies[0].Names)
	}
}

func TestScanTarballTauriParsesCargoAndNPM(t *testing.T) {
	tgz := makeTarball(t, "desk-abc", map[string]string{
		"package.json":          `{"dependencies":{"@tauri-apps/api":"2.0.0"}}`,
		"src/App.tsx":           "export {}\n",
		"src-tauri/Cargo.toml":  mustReadTestdata(t, "Cargo.toml"),
		"src-tauri/src/main.rs": "fn main() {}\n",
	})
	var res Result
	if err := scanTarball(bytes.NewReader(tgz), &res); err != nil {
		t.Fatal(err)
	}
	byEco := map[string]Manifest{}
	for _, m := range res.Dependencies {
		byEco[m.Ecosystem] = m
	}
	if byEco["npm"].Manifest != "package.json" {
		t.Errorf("npm manifest = %q", byEco["npm"].Manifest)
	}
	if byEco["cargo"].Manifest != "src-tauri/Cargo.toml" {
		t.Errorf("cargo manifest = %q", byEco["cargo"].Manifest)
	}
}

func TestScanTarballElectronParsesPackageJSON(t *testing.T) {
	tgz := makeTarball(t, "desk-abc", map[string]string{
		"package.json":      `{"dependencies":{"electron":"28.0.0"}}`,
		"main/index.js":     "console.log(1)\n",
		"renderer/index.js": "console.log(2)\n",
	})
	var res Result
	if err := scanTarball(bytes.NewReader(tgz), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Dependencies) != 1 || res.Dependencies[0].Ecosystem != "npm" {
		t.Fatalf("dependencies = %+v, want electron package.json", res.Dependencies)
	}
	if got := strings.Join(res.Stats.TopLevelDirs, ","); got != "main,renderer" {
		t.Errorf("top-level dirs = %q, want main,renderer", got)
	}
}

func mustReadTestdata(t *testing.T, base string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", base))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// makeTarball builds a gzipped tarball shaped like codeload's: every entry
// under a "repo-sha/" root, plus the pax_global_header codeload emits.
func makeTarball(t *testing.T, root string, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	write := func(hdr *tar.Header, body string) {
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	write(&tar.Header{Name: "pax_global_header", Typeflag: tar.TypeXGlobalHeader}, "")
	write(&tar.Header{Name: root + "/", Typeflag: tar.TypeDir, Mode: 0o755}, "")
	names := make([]string, 0, len(entries))
	for name := range entries {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		body := entries[name]
		if strings.HasSuffix(name, "/") {
			write(&tar.Header{Name: root + "/" + name, Typeflag: tar.TypeDir, Mode: 0o755}, "")
			continue
		}
		write(&tar.Header{Name: root + "/" + name, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(body))}, body)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
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
