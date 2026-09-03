package appgraph

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

type pkgJSON struct {
	Scripts         map[string]string `json:"scripts"`
	Dependencies    map[string]string `json:"dependencies"`
	DevDependencies map[string]string `json:"devDependencies"`
	Bin             json.RawMessage   `json:"bin"`
	Main            string            `json:"main"`
	Typings         string            `json:"typings"`
	Types           string            `json:"types"`
	Exports         json.RawMessage   `json:"exports"`
}

func (p pkgJSON) has(dep string) bool {
	return p.Dependencies[dep] != "" || p.DevDependencies[dep] != ""
}

// script returns the first of dev/start that exists.
func (p pkgJSON) script() string {
	for _, name := range []string{"dev", "start"} {
		if p.Scripts[name] != "" {
			return name
		}
	}
	return ""
}

func (p pkgJSON) hasBin() bool {
	s := strings.TrimSpace(string(p.Bin))
	return s != "" && s != "null" && s != "{}" && s != "[]"
}

func (p pkgJSON) published() bool {
	if p.Main != "" || p.Typings != "" || p.Types != "" {
		return true
	}
	s := strings.TrimSpace(string(p.Exports))
	return s != "" && s != "null" && s != "{}" && s != "[]"
}

// webFrameworks maps a dependency to the framework name, most specific first:
// a Next app also ships react, and a Remix app also ships vite.
var webFrameworks = []struct{ dep, framework string }{
	{"next", "next"},
	{"@remix-run/dev", "remix"},
	{"@sveltejs/kit", "sveltekit"},
	{"@angular/cli", "angular"},
	{"nuxt", "nuxt"},
	{"astro", "astro"},
	{"react-scripts", "cra"},
	{"vite", "vite"},
}

var apiFrameworks = []struct{ dep, framework string }{
	{"@nestjs/core", "nest"},
	{"fastify", "fastify"},
	{"express", "express"},
}

// defaultPorts is what each framework listens on when nothing says otherwise.
var defaultPorts = map[string]int{
	"vite": 5173, "next": 3000, "cra": 3000, "angular": 4200,
	"sveltekit": 5173, "astro": 4321, "nuxt": 3000, "remix": 3000,
	"expo": 8081, "nest": 3000, "fastify": 3000, "express": 3000,
	"django": 8000, "fastapi": 8000, "flask": 5000,
}

// fromNode reads dir/package.json and classifies it as web, api, mobile,
// desktop, cli or library. A workspace root with no script, bin or publish
// fields yields nothing.
func fromNode(root, dir string) []App {
	data, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		return nil
	}
	var pkg pkgJSON
	if json.Unmarshal(data, &pkg) != nil {
		return nil
	}
	pm := packageManager(dir, root)
	base := App{Dir: rel(root, dir), Install: pm + " install", Previewable: true}

	if app, ok := tauriApp(base, dir, pm, pkg); ok {
		return []App{app}
	}
	if pkg.has("electron") {
		return []App{electronApp(base, pm, pkg)}
	}
	if app, ok := expoApp(base, dir, pm, pkg); ok {
		return []App{app}
	}
	if pkg.has("react-native") {
		base.Kind, base.Framework, base.Previewable = KindMobile, "react-native", false
		base.Reason = "Bare React Native needs a Metro bundler plus an iOS or Android simulator, which Terra cannot run. Add Expo's web target to preview it."
		return []App{base}
	}

	script := pkg.script()
	cmd := ""
	if script != "" {
		cmd = pkg.Scripts[script]
	}

	if script != "" && !notADevServer(cmd) {
		base.Run = pm + " run " + script
		for _, fw := range webFrameworks {
			if pkg.has(fw.dep) {
				return []App{withFramework(base, KindWeb, fw.framework)}
			}
		}
		for _, fw := range apiFrameworks {
			if pkg.has(fw.dep) {
				return []App{withFramework(base, KindAPI, fw.framework)}
			}
		}
	}

	if pkg.hasBin() {
		return []App{cliApp(base)}
	}
	if script != "" && notADevServer(cmd) {
		return []App{libraryApp(base, libraryReason(cmd))}
	}
	if script != "" {
		// A runnable script with no framework evidence still boots something;
		// the launcher treats "node" as flag-free (node server.js).
		base.Run = pm + " run " + script
		return []App{withFramework(base, KindWeb, "node")}
	}
	if pkg.published() {
		return []App{libraryApp(base, "This is a library, not a web app. Live preview will show the README and tests; there is no page to iframe.")}
	}
	return nil
}

func cliApp(base App) App {
	base.Kind, base.Framework, base.Previewable = KindCLI, "node", false
	base.Reason = "This is a command-line tool. Terra runs it in a terminal — type arguments after --help."
	return base
}

func libraryApp(base App, reason string) App {
	base.Kind, base.Framework, base.Previewable = KindLibrary, "node", false
	base.Run = ""
	base.Reason = reason
	return base
}

func libraryReason(cmd string) string {
	if strings.Contains(strings.ToLower(cmd), "allure") {
		return "This start script only serves Allure test reports, not a product UI."
	}
	return "This start script runs tests or a build, not a web server. Live preview will show the README and tests."
}

// notADevServer is true when the script is a test, linter, compiler or report
// server — something Terra must not iframe as a product.
func notADevServer(cmd string) bool {
	s := strings.TrimSpace(cmd)
	if s == "" || s == ":" {
		return true
	}
	low := strings.ToLower(s)
	for _, needle := range []string{
		"allure", "jest", "mocha", "vitest", "eslint", "prettier",
		"husky", "commitlint", "tsc", "lint-staged",
	} {
		if strings.Contains(low, needle) {
			return true
		}
	}
	return false
}

func withFramework(app App, kind Kind, framework string) App {
	app.Kind, app.Framework = kind, framework
	if port, ok := defaultPorts[framework]; ok {
		app.Ports = []int{port}
	}
	return app
}

/* ---------- expo ---------- */

func expoApp(base App, dir, pm string, pkg pkgJSON) (App, bool) {
	if !pkg.has("expo") && !appJSONHasExpo(dir) {
		return App{}, false
	}
	base.Run = "npx expo start --web"
	if pkg.Scripts["web"] != "" {
		base.Run = pm + " run web"
	}
	return withFramework(base, KindMobile, "expo"), true
}

func appJSONHasExpo(dir string) bool {
	data, err := os.ReadFile(filepath.Join(dir, "app.json"))
	if err != nil {
		return false
	}
	var cfg map[string]json.RawMessage
	if json.Unmarshal(data, &cfg) != nil {
		return false
	}
	_, ok := cfg["expo"]
	return ok
}

/* ---------- electron ---------- */

// rendererScripts are searched in order: Terra previews the renderer in an
// iframe, never the Electron shell, which needs a desktop window.
var rendererScripts = []string{"dev:renderer", "renderer", "dev:web", "start:renderer", "dev", "start"}

var rendererTools = []string{"vite", "next", "webpack", "parcel", "ng serve", "astro", "nuxt", "svelte-kit", "react-scripts"}

func electronApp(base App, pm string, pkg pkgJSON) App {
	base.Kind, base.Framework = KindDesktop, "electron"
	for _, name := range rendererScripts {
		cmd := pkg.Scripts[name]
		if cmd == "" || strings.Contains(cmd, "electron") {
			continue
		}
		for _, tool := range rendererTools {
			if strings.Contains(cmd, tool) {
				base.Run = pm + " run " + name
				return base
			}
		}
	}
	base.Previewable = false
	base.Reason = "This Electron app has no renderer dev script Terra can boot on its own; only the desktop shell, which needs a window Terra cannot open."
	return base
}

/* ---------- tauri ---------- */

func tauriApp(base App, dir, pm string, pkg pkgJSON) (App, bool) {
	data, err := os.ReadFile(filepath.Join(dir, "src-tauri", "tauri.conf.json"))
	if err != nil {
		return App{}, false
	}
	var conf struct {
		Build struct {
			DevURL           string `json:"devUrl"`
			DevPath          string `json:"devPath"`
			BeforeDevCommand string `json:"beforeDevCommand"`
		} `json:"build"`
	}
	if json.Unmarshal(data, &conf) != nil {
		return App{}, false
	}
	base.Kind, base.Framework = KindDesktop, "tauri"
	switch {
	case conf.Build.BeforeDevCommand != "":
		base.Run = conf.Build.BeforeDevCommand
	case pkg.script() != "":
		base.Run = pm + " run " + pkg.script()
	default:
		base.Previewable = false
		base.Reason = "This Tauri app declares no beforeDevCommand and no dev script, so Terra cannot start its frontend."
		return base, true
	}
	if port := urlPort(firstNonEmpty(conf.Build.DevURL, conf.Build.DevPath)); port != 0 {
		base.Ports = []int{port}
	}
	return base, true
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

/* ---------- package manager ---------- */

// packageManager reads the lockfile next to the app, then the repo root.
func packageManager(dir, root string) string {
	for _, at := range []string{dir, root} {
		if exists(at, "pnpm-lock.yaml") {
			return "pnpm"
		}
		if exists(at, "yarn.lock") {
			return "yarn"
		}
	}
	return "npm"
}
