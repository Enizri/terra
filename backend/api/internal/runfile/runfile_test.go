package runfile

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func repo(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for name, body := range files {
		full := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// A repo that ships a Dockerfile AND a runnable manifest must boot: the
// host-runnable evidence wins, the Dockerfile is only a fallback.
func TestInferencePrefersHostRunnable(t *testing.T) {
	root := repo(t, map[string]string{
		"Dockerfile":   "FROM node:20\nEXPOSE 3000 8080/tcp\nCMD [\"node\", \"server.js\"]\n",
		"package.json": `{"scripts":{"dev":"vite"}}`,
	})
	rf, err := Infer(root)
	if err != nil {
		t.Fatal(err)
	}
	if rf.Source != "package.json" || !rf.HostRunnable() {
		t.Errorf("rf = %+v, want the host-runnable package.json evidence", rf)
	}
}

func TestInferenceDockerfileFallback(t *testing.T) {
	root := repo(t, map[string]string{
		"Dockerfile": "FROM node:20\nEXPOSE 3000 8080/tcp\nCMD [\"node\", \"server.js\"]\n",
	})
	rf, err := Infer(root)
	if err != nil {
		t.Fatal(err)
	}
	if rf.Source != "dockerfile" || rf.Run != "node server.js" {
		t.Errorf("rf = %+v, want the Dockerfile CMD", rf)
	}
	if !reflect.DeepEqual(rf.Ports, []int{3000, 8080}) {
		t.Errorf("ports = %v", rf.Ports)
	}
	if rf.HostRunnable() {
		t.Error("a Dockerfile CMD assumes a container; it must not be host-runnable")
	}
}

func TestComposePorts(t *testing.T) {
	root := repo(t, map[string]string{
		"docker-compose.yml": "services:\n  web:\n    ports:\n      - \"8080:80\"\n      - \"9000\"\n    image: x\n",
	})
	rf, err := Infer(root)
	if err != nil {
		t.Fatal(err)
	}
	if rf.Source != "compose" || !reflect.DeepEqual(rf.Ports, []int{80, 9000}) {
		t.Errorf("rf = %+v, want container ports 80 and 9000", rf)
	}
}

func TestPackageJSON(t *testing.T) {
	root := repo(t, map[string]string{
		"package.json":   `{"scripts":{"start":"node index.js"}}`,
		"pnpm-lock.yaml": "",
	})
	rf, err := Infer(root)
	if err != nil {
		t.Fatal(err)
	}
	want := &Runfile{Source: "package.json", Install: "pnpm install", Run: "pnpm run start"}
	if !reflect.DeepEqual(rf, want) {
		t.Errorf("rf = %+v, want %+v", rf, want)
	}
	if !rf.HostRunnable() {
		t.Error("a package.json script is host-runnable")
	}
}

func TestGoMod(t *testing.T) {
	root := repo(t, map[string]string{
		"go.mod":              "module x\n",
		"cmd/server/main.go":  "package main\n",
		"internal/foo/foo.go": "package foo\n",
	})
	rf, err := Infer(root)
	if err != nil {
		t.Fatal(err)
	}
	if rf.Source != "go.mod" || rf.Run != "go run ./cmd/server" {
		t.Errorf("rf = %+v", rf)
	}
}

func TestPythonFastAPI(t *testing.T) {
	root := repo(t, map[string]string{
		"requirements.txt": "fastapi\nuvicorn\n",
		"main.py":          "app = None\n",
	})
	rf, err := Infer(root)
	if err != nil {
		t.Fatal(err)
	}
	if rf.Source != "python" || rf.Run != "uvicorn main:app --host 0.0.0.0 --port {port}" {
		t.Errorf("rf = %+v", rf)
	}
	if rf.Install != "pip install -r requirements.txt" {
		t.Errorf("install = %q", rf.Install)
	}
}

func TestNoEvidenceIsErrUnknown(t *testing.T) {
	root := repo(t, map[string]string{"README.md": "hi"})
	if _, err := Infer(root); err != ErrUnknown {
		t.Errorf("err = %v, want ErrUnknown", err)
	}
}

func TestCacheRoundTripBySHA(t *testing.T) {
	t.Setenv("HOME", t.TempDir()) // os.UserCacheDir derives from HOME
	sha := "deadbeef"
	if got := Load(sha); got != nil {
		t.Fatalf("cold cache returned %+v", got)
	}
	rf := &Runfile{Source: "go.mod", Run: "go run ."}
	Save(sha, rf)
	if got := Load(sha); !reflect.DeepEqual(got, rf) {
		t.Errorf("Load = %+v, want %+v", got, rf)
	}

	// For() must hit the cache without touching the (empty) checkout.
	got, err := For(t.TempDir(), sha)
	if err != nil || !reflect.DeepEqual(got, rf) {
		t.Errorf("For = %+v, %v; want the cached runfile", got, err)
	}
}

// The cache key carries a version and a kind: a wrong answer cached by an
// older Terra must not stick to that commit, and two kinds of inference for
// the same commit must not overwrite each other.
func TestCacheKeyIsVersionedAndNamespaced(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	cache, err := os.UserCacheDir()
	if err != nil {
		t.Fatal(err)
	}
	sha := "cafebabe"

	legacy := filepath.Join(cache, "terra", "runfiles", sha+".json")
	if err := os.MkdirAll(filepath.Dir(legacy), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, []byte(`{"source":"dockerfile","run":"wrong"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := Load(sha); got != nil {
		t.Fatalf("Load read an unversioned entry: %+v", got)
	}

	SaveJSON("appgraph", sha, []string{"other kind of inference"})
	if got := Load(sha); got != nil {
		t.Fatalf("Load read another kind's entry: %+v", got)
	}
	Save(sha, &Runfile{Source: "go.mod", Run: "go run ."})
	var apps []string
	if !LoadJSON("appgraph", sha, &apps) || len(apps) != 1 {
		t.Fatalf("appgraph entry = %v, want it untouched by Save", apps)
	}
}
