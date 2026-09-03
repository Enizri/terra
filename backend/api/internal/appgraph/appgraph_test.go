package appgraph

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
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

// withFlutterSDK pretends the flutter binary is (or is not) on PATH.
func withFlutterSDK(t *testing.T, installed bool) {
	t.Helper()
	prev := lookPath
	lookPath = func(name string) (string, error) {
		if installed {
			return "/usr/bin/" + name, nil
		}
		return "", os.ErrNotExist
	}
	t.Cleanup(func() { lookPath = prev })
}

func find(apps []App, dir string) (App, bool) {
	for _, app := range apps {
		if app.Dir == dir {
			return app, true
		}
	}
	return App{}, false
}

// want is the shape a fixture tree must produce, app by app, primary first.
type want struct {
	dir, framework string
	kind           Kind
	previewable    bool
	reason         string // substring; only checked when set
}

func TestDetectShapes(t *testing.T) {
	viteApp := `{"scripts":{"dev":"vite"},"devDependencies":{"vite":"^5","react":"^19"}}`
	nextApp := `{"scripts":{"dev":"next dev"},"dependencies":{"next":"^15","react":"^19"}}`

	cases := []struct {
		name    string
		files   map[string]string
		flutter bool
		want    []want
	}{
		{
			name:  "vite only",
			files: map[string]string{"package.json": viteApp},
			want:  []want{{dir: ".", kind: KindWeb, framework: "vite", previewable: true}},
		},
		{
			name: "next plus go api",
			files: map[string]string{
				"web/package.json":  nextApp,
				"go.mod":            "module x\n",
				"cmd/api/main.go":   "package main\n",
				"cmd/seed/main.go":  "package main\n",
				"internal/x/pkg.go": "package x\n",
			},
			want: []want{
				{dir: "web", kind: KindWeb, framework: "next", previewable: true},
				{dir: ".", kind: KindAPI, framework: "go", previewable: true},
				{dir: ".", kind: KindAPI, framework: "go", previewable: false, reason: "./cmd/api"},
			},
		},
		{
			name: "expo",
			files: map[string]string{
				"package.json": `{"scripts":{"start":"expo start"},"dependencies":{"expo":"~51","react-native":"0.74"}}`,
				"app.json":     `{"expo":{"name":"demo"}}`,
			},
			want: []want{{dir: ".", kind: KindMobile, framework: "expo", previewable: true}},
		},
		{
			name: "bare react native",
			files: map[string]string{
				"package.json":                       `{"scripts":{"start":"react-native start"},"dependencies":{"react-native":"0.74"}}`,
				"ios/Demo.xcodeproj/project.pbxproj": "",
				"android/build.gradle":               "classpath 'com.android.tools.build:gradle:8.0'\n",
			},
			want: []want{{dir: ".", kind: KindMobile, framework: "react-native", previewable: false, reason: "Metro"}},
		},
		{
			name:    "flutter with the sdk installed",
			files:   map[string]string{"pubspec.yaml": "name: demo\nflutter:\n  uses-material-design: true\n"},
			flutter: true,
			want:    []want{{dir: ".", kind: KindMobile, framework: "flutter", previewable: true}},
		},
		{
			name: "flutter without the sdk",
			files: map[string]string{
				"pubspec.yaml":                         "name: demo\nflutter:\n  uses-material-design: true\n",
				"ios/Runner.xcodeproj/project.pbxproj": "",
			},
			want: []want{{dir: ".", kind: KindMobile, framework: "flutter", previewable: false, reason: "Flutter SDK is not installed"}},
		},
		{
			name: "electron",
			files: map[string]string{
				"package.json": `{"scripts":{"dev":"electron .","dev:renderer":"vite"},"devDependencies":{"electron":"^30"}}`,
			},
			want: []want{{dir: ".", kind: KindDesktop, framework: "electron", previewable: true}},
		},
		{
			name: "electron shell only",
			files: map[string]string{
				"package.json": `{"scripts":{"start":"electron ."},"devDependencies":{"electron":"^30"}}`,
			},
			want: []want{{dir: ".", kind: KindDesktop, framework: "electron", previewable: false, reason: "renderer dev script"}},
		},
		{
			name: "tauri",
			files: map[string]string{
				"package.json":              viteApp,
				"src-tauri/tauri.conf.json": `{"build":{"devUrl":"http://localhost:1420","beforeDevCommand":"npm run dev"}}`,
				"src-tauri/Cargo.toml":      "[package]\nname = \"demo\"\n",
			},
			want: []want{{dir: ".", kind: KindDesktop, framework: "tauri", previewable: true}},
		},
		{
			name: "monorepo",
			files: map[string]string{
				"apps/web/package.json":     viteApp,
				"apps/mobile/package.json":  `{"scripts":{"start":"expo start"},"dependencies":{"expo":"~51"}}`,
				"apps/desktop/package.json": `{"scripts":{"dev:renderer":"vite"},"devDependencies":{"electron":"^30"}}`,
				"services/api/go.mod":       "module x\n",
				"services/api/main.go":      "package main\n",
				"package.json":              `{"private":true,"workspaces":["apps/*"]}`,
			},
			want: []want{
				{dir: "apps/web", kind: KindWeb, framework: "vite", previewable: true},
				{dir: "services/api", kind: KindAPI, framework: "go", previewable: true},
				{dir: "apps/desktop", kind: KindDesktop, framework: "electron", previewable: true},
				{dir: "apps/mobile", kind: KindMobile, framework: "expo", previewable: true},
			},
		},
		{
			name: "npm library",
			files: map[string]string{
				"package.json": `{"name":"lib","main":"./index.js","exports":{".":"./index.js"},"scripts":{"test":"jest"}}`,
			},
			want: []want{{dir: ".", kind: KindLibrary, framework: "node", previewable: false, reason: "library"}},
		},
		{
			name: "allure e2e is not a web app",
			files: map[string]string{
				"package.json":     `{"name":"reporter","main":"./index.js","exports":{".":"./index.js"}}`,
				"e2e/package.json": `{"scripts":{"start":"ALLURE_NO_ANALYTICS=1 allure serve allure-results","test":"jest"}}`,
			},
			want: []want{
				{dir: ".", kind: KindLibrary, framework: "node", previewable: false, reason: "library"},
				{dir: "e2e", kind: KindLibrary, framework: "node", previewable: false, reason: "Allure"},
			},
		},
		{
			name: "npm cli",
			files: map[string]string{
				"package.json": `{"bin":{"map":"./bin/map.js"},"scripts":{"test":"jest"}}`,
			},
			want: []want{{dir: ".", kind: KindCLI, framework: "node", previewable: false, reason: "command-line"}},
		},
		{
			name: "go cobra cli",
			files: map[string]string{
				"go.mod":          "module x\nrequire github.com/spf13/cobra v1.8.0\n",
				"cmd/map/main.go": "package main\n",
			},
			want: []want{{dir: ".", kind: KindCLI, framework: "go", previewable: false, reason: "CLI"}},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			withFlutterSDK(t, tc.flutter)
			apps, err := Detect(repo(t, tc.files))
			if err != nil {
				t.Fatal(err)
			}
			if len(apps) != len(tc.want) {
				t.Fatalf("got %d apps %+v, want %d", len(apps), apps, len(tc.want))
			}
			for i, w := range tc.want {
				got := apps[i]
				if got.Dir != w.dir || got.Kind != w.kind || got.Framework != w.framework {
					t.Errorf("app %d = {dir:%q kind:%q framework:%q}, want {dir:%q kind:%q framework:%q}",
						i, got.Dir, got.Kind, got.Framework, w.dir, w.kind, w.framework)
				}
				if got.Previewable != w.previewable {
					t.Errorf("app %d (%s) previewable = %v, want %v (reason %q)", i, got.ID, got.Previewable, w.previewable, got.Reason)
				}
				if !w.previewable && got.Reason == "" {
					t.Errorf("app %d (%s) is not previewable and must say why", i, got.ID)
				}
				if w.reason != "" && !strings.Contains(got.Reason, w.reason) {
					t.Errorf("app %d reason = %q, want it to mention %q", i, got.Reason, w.reason)
				}
			}
		})
	}
}

// Depth 3 is the point of the rewrite: apps/web/client/package.json was
// invisible to the old depth-2 walk.
func TestDetectReachesDepthThree(t *testing.T) {
	root := repo(t, map[string]string{
		"apps/web/client/package.json": `{"scripts":{"dev":"vite"},"devDependencies":{"vite":"^5"}}`,
	})
	apps, err := Detect(root)
	if err != nil {
		t.Fatal(err)
	}
	if apps[0].Dir != "apps/web/client" || apps[0].ID != "apps-web-client" {
		t.Fatalf("got %+v, want the depth-3 client app", apps[0])
	}
}

func TestDetectSkipsVendoredAndExampleTrees(t *testing.T) {
	root := repo(t, map[string]string{
		"package.json":                      `{"scripts":{"dev":"vite"},"devDependencies":{"vite":"^5"}}`,
		"node_modules/dep/package.json":     `{"scripts":{"dev":"vite"}}`,
		"examples/demo/package.json":        `{"scripts":{"dev":"vite"}}`,
		"dist/package.json":                 `{"scripts":{"dev":"vite"}}`,
		"vendor/x/package.json":             `{"scripts":{"dev":"vite"}}`,
		"packages/ui/node_modules/p/go.mod": "module x\n",
	})
	apps, err := Detect(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(apps) != 1 || apps[0].Dir != "." {
		t.Fatalf("got %+v, want only the root app", apps)
	}
}

// The old detect() preferred a nested react/vite app over a root package that
// only had "start"; that tie-break has to survive.
func TestShallowerAndKnownFrameworksWin(t *testing.T) {
	root := repo(t, map[string]string{
		"package.json":     `{"scripts":{"start":"node server.js"}}`,
		"web/package.json": `{"scripts":{"dev":"vite"},"devDependencies":{"vite":"^5","react":"^19"}}`,
	})
	apps, err := Detect(root)
	if err != nil {
		t.Fatal(err)
	}
	if apps[0].Dir != "web" || apps[0].Framework != "vite" {
		t.Fatalf("primary = %+v, want the vite app under web/", apps[0])
	}
}

func TestWebDependsOnAPI(t *testing.T) {
	root := repo(t, map[string]string{
		"web/package.json": `{"scripts":{"dev":"vite"},"devDependencies":{"vite":"^5"}}`,
		"api/go.mod":       "module x\n",
		"api/main.go":      "package main\n",
	})
	apps, err := Detect(root)
	if err != nil {
		t.Fatal(err)
	}
	api, ok := find(apps, "api")
	if !ok {
		t.Fatal("no api app")
	}
	web, _ := find(apps, "web")
	if !reflect.DeepEqual(web.DependsOn, []string{api.ID}) {
		t.Fatalf("web.DependsOn = %v, want [%s]", web.DependsOn, api.ID)
	}
	if api.DependsOn != nil {
		t.Fatalf("api.DependsOn = %v, want nothing", api.DependsOn)
	}
}

func TestPrimaryPrefersAPreviewableApp(t *testing.T) {
	root := repo(t, map[string]string{
		"package.json": `{"scripts":{"start":"react-native start"},"dependencies":{"react-native":"0.74"}}`,
	})
	apps, err := Detect(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := Primary(apps); ok {
		t.Fatal("a bare React Native repo has nothing to preview")
	}
}

func TestDetectEmptyRepo(t *testing.T) {
	if _, err := Detect(repo(t, map[string]string{"README.md": "hi"})); err == nil {
		t.Fatal("want an error when nothing is runnable")
	}
}

func TestPythonAPIs(t *testing.T) {
	root := repo(t, map[string]string{
		"requirements.txt": "django==5.0\n",
		"manage.py":        "",
	})
	apps, err := Detect(root)
	if err != nil {
		t.Fatal(err)
	}
	if apps[0].Framework != "django" || apps[0].Kind != KindAPI || apps[0].Run == "" {
		t.Fatalf("got %+v, want a django api", apps[0])
	}
}

func TestPythonClickIsACLI(t *testing.T) {
	root := repo(t, map[string]string{"requirements.txt": "click==8.1.0\n"})
	apps, err := Detect(root)
	if err != nil {
		t.Fatal(err)
	}
	if apps[0].Kind != KindCLI || apps[0].Previewable || !strings.Contains(apps[0].Reason, "CLI") {
		t.Fatalf("got %+v, want a python CLI that is not previewable", apps[0])
	}
}

func TestWorkspaceRootIsNotAnApp(t *testing.T) {
	root := repo(t, map[string]string{
		"package.json": `{"private":true,"workspaces":["e2e"]}`,
	})
	if _, err := Detect(root); err == nil {
		t.Fatal("a workspaces-only root is not an app")
	}
}

func TestForCachesByCommit(t *testing.T) {
	t.Setenv("HOME", t.TempDir()) // os.UserCacheDir derives from HOME
	root := repo(t, map[string]string{"package.json": `{"scripts":{"dev":"vite"},"devDependencies":{"vite":"^5"}}`})
	first, err := For(root, "deadbeef")
	if err != nil {
		t.Fatal(err)
	}
	// Remove the evidence: a second call must come back from the cache.
	if err := os.Remove(filepath.Join(root, "package.json")); err != nil {
		t.Fatal(err)
	}
	second, err := For(root, "deadbeef")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("cached %+v, want %+v", second, first)
	}
	if _, err := For(root, ""); err == nil {
		t.Fatal("an empty sha skips the cache, so detection must fail here")
	}
}
