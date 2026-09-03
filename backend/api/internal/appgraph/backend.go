package appgraph

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// preferredCommands are the cmd/<name> entry points that win when a module
// ships several. Historically Terra gave up unless there was exactly one.
var preferredCommands = []string{"api", "server", "web"}

// fromGo returns one app per entry point of the module in dir, the default
// first; the rest are listed but not previewable.
func fromGo(root, dir string) []App {
	if !exists(dir, "go.mod") {
		return nil
	}
	var pkgs []string
	if exists(dir, "main.go") {
		pkgs = append(pkgs, ".")
	}
	mains, _ := filepath.Glob(filepath.Join(dir, "cmd", "*", "main.go"))
	sort.Strings(mains)
	for _, main := range mains {
		pkgs = append(pkgs, "./cmd/"+filepath.Base(filepath.Dir(main)))
	}
	if len(pkgs) == 0 {
		return nil
	}
	def := defaultGoPkg(pkgs)
	var apps []App
	for _, pkg := range pkgs {
		app := App{
			Dir: rel(root, dir), Kind: KindAPI, Framework: "go",
			Install: "go mod download", Run: "go run " + pkg, Previewable: pkg == def,
		}
		if !app.Previewable {
			app.Reason = fmt.Sprintf("Secondary entry point: Terra boots %s for this module.", def)
		}
		apps = append(apps, app)
	}
	return apps
}

func defaultGoPkg(pkgs []string) string {
	for _, want := range preferredCommands {
		for _, pkg := range pkgs {
			if pkg == "./cmd/"+want {
				return pkg
			}
		}
	}
	return pkgs[0]
}

/* ---------- python ---------- */

// fromPython mirrors the runfile templates, which are the commands the host
// runner already knows how to start.
func fromPython(root, dir string) []App {
	install := ""
	switch {
	case exists(dir, "requirements.txt"):
		install = "pip install -r requirements.txt"
	case exists(dir, "pyproject.toml"):
		install = "pip install -e ."
	default:
		return nil
	}
	base := App{Dir: rel(root, dir), Kind: KindAPI, Install: install, Previewable: true}
	deps := pythonDeps(dir)
	switch {
	case exists(dir, "manage.py"):
		base.Run = "python manage.py runserver 0.0.0.0:{port}"
		return []App{withFramework(base, KindAPI, "django")}
	case (deps["fastapi"] || deps["uvicorn"]) && appModule(dir) != "":
		base.Run = "uvicorn " + appModule(dir) + ":app --host 0.0.0.0 --port {port}"
		return []App{withFramework(base, KindAPI, "fastapi")}
	case deps["flask"] && exists(dir, "app.py"):
		base.Run = "flask --app app run --port {port}"
		return []App{withFramework(base, KindAPI, "flask")}
	}
	return nil
}

func pythonDeps(dir string) map[string]bool {
	deps := map[string]bool{}
	for _, name := range []string{"requirements.txt", "pyproject.toml"} {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		low := strings.ToLower(string(data))
		for _, dep := range []string{"fastapi", "uvicorn", "flask", "django"} {
			if strings.Contains(low, dep) {
				deps[dep] = true
			}
		}
	}
	return deps
}

func appModule(dir string) string {
	for _, mod := range []string{"main", "app"} {
		if exists(dir, mod+".py") {
			return mod
		}
	}
	return ""
}

/* ---------- helpers ---------- */

// urlPort pulls the port out of a dev URL like http://localhost:1420.
func urlPort(raw string) int {
	if raw == "" {
		return 0
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return 0
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil {
		return 0
	}
	return port
}
