// Package runfile infers how to install and run a repository — the small
// per-repo spec the roadmap calls a Runfile. Inference is deterministic and
// file-based (Dockerfile → compose → language manifests); results are cached
// by commit SHA so a repo is inferred once, ever. When nothing matches, the
// caller may ask the analyzer's runfile task to write one — that path is
// recorded but never auto-executed on the host.
package runfile

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type Runfile struct {
	// Source names the evidence: dockerfile, compose, package.json, go.mod,
	// python, or agent.
	Source  string `json:"source"`
	Install string `json:"install,omitempty"`
	// Run is the boot command; "{port}" is substituted at boot time.
	Run string `json:"run,omitempty"`
	// Dir is the repo-relative working directory ("" = root).
	Dir   string `json:"dir,omitempty"`
	Ports []int  `json:"ports,omitempty"`
}

// HostRunnable reports whether Run is safe-ish to execute directly on the
// host: only commands assembled by Terra's own deterministic inference.
// Dockerfile CMDs assume a container, and agent-written commands are LLM
// output — neither runs outside a sandbox.
func (r *Runfile) HostRunnable() bool {
	switch r.Source {
	case "package.json", "go.mod", "python":
		return r.Run != ""
	}
	return false
}

// ErrUnknown means no manifest matched; the analyzer agent is the fallback.
var ErrUnknown = errors.New("no runfile evidence found")

// Infer walks the roadmap's inference order against a checkout root.
func Infer(root string) (*Runfile, error) {
	for _, try := range []func(string) *Runfile{fromDockerfile, fromCompose, fromPackageJSON, fromGoMod, fromPython} {
		if rf := try(root); rf != nil {
			return rf, nil
		}
	}
	return nil, ErrUnknown
}

/* ---------- Dockerfile ---------- */

var exposeRe = regexp.MustCompile(`(?im)^\s*EXPOSE\s+(.+)$`)
var cmdRe = regexp.MustCompile(`(?im)^\s*(?:CMD|ENTRYPOINT)\s+(.+)$`)

func fromDockerfile(root string) *Runfile {
	data, err := os.ReadFile(filepath.Join(root, "Dockerfile"))
	if err != nil {
		return nil
	}
	rf := &Runfile{Source: "dockerfile"}
	for _, match := range exposeRe.FindAllStringSubmatch(string(data), -1) {
		for _, tok := range strings.Fields(match[1]) {
			if port, err := strconv.Atoi(strings.SplitN(tok, "/", 2)[0]); err == nil {
				rf.Ports = append(rf.Ports, port)
			}
		}
	}
	if match := cmdRe.FindStringSubmatch(string(data)); match != nil {
		rf.Run = parseDockerCmd(match[1])
	}
	return rf
}

// parseDockerCmd flattens both CMD forms to one display string.
func parseDockerCmd(raw string) string {
	raw = strings.TrimSpace(raw)
	var parts []string
	if json.Unmarshal([]byte(raw), &parts) == nil {
		return strings.Join(parts, " ")
	}
	return raw
}

/* ---------- docker-compose ---------- */

// ponytail: line-based YAML scan for ports only; bring in a YAML parser when
// a real compose file breaks it.
var composePortRe = regexp.MustCompile(`^\s*-\s*"?(?:\d+:)?(\d+)"?\s*$`)

func fromCompose(root string) *Runfile {
	for _, name := range []string{"docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"} {
		data, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			continue
		}
		rf := &Runfile{Source: "compose"}
		inPorts := false
		for _, line := range strings.Split(string(data), "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "ports:") {
				inPorts = true
				continue
			}
			if inPorts {
				match := composePortRe.FindStringSubmatch(line)
				if match == nil {
					inPorts = false
					continue
				}
				if port, err := strconv.Atoi(match[1]); err == nil {
					rf.Ports = append(rf.Ports, port)
				}
			}
		}
		return rf
	}
	return nil
}

/* ---------- package.json ---------- */

func fromPackageJSON(root string) *Runfile {
	data, err := os.ReadFile(filepath.Join(root, "package.json"))
	if err != nil {
		return nil
	}
	var pkg struct {
		Scripts map[string]string `json:"scripts"`
	}
	if json.Unmarshal(data, &pkg) != nil {
		return nil
	}
	script := ""
	if pkg.Scripts["dev"] != "" {
		script = "dev"
	} else if pkg.Scripts["start"] != "" {
		script = "start"
	}
	if script == "" {
		return nil
	}
	pm := "npm"
	if _, err := os.Stat(filepath.Join(root, "pnpm-lock.yaml")); err == nil {
		pm = "pnpm"
	} else if _, err := os.Stat(filepath.Join(root, "yarn.lock")); err == nil {
		pm = "yarn"
	}
	return &Runfile{
		Source:  "package.json",
		Install: pm + " install",
		Run:     pm + " run " + script,
	}
}

/* ---------- go.mod ---------- */

func fromGoMod(root string) *Runfile {
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err != nil {
		return nil
	}
	if _, err := os.Stat(filepath.Join(root, "main.go")); err == nil {
		return &Runfile{Source: "go.mod", Run: "go run ."}
	}
	mains, err := filepath.Glob(filepath.Join(root, "cmd", "*", "main.go"))
	if err != nil || len(mains) != 1 {
		return nil
	}
	return &Runfile{Source: "go.mod", Run: "go run ./cmd/" + filepath.Base(filepath.Dir(mains[0]))}
}

/* ---------- python ---------- */

func fromPython(root string) *Runfile {
	reqs := ""
	if _, err := os.Stat(filepath.Join(root, "requirements.txt")); err == nil {
		reqs = "pip install -r requirements.txt"
	} else if _, err := os.Stat(filepath.Join(root, "pyproject.toml")); err == nil {
		reqs = "pip install -e ."
	} else {
		return nil
	}
	deps := pythonDeps(root)
	switch {
	case fileExists(root, "manage.py"):
		return &Runfile{Source: "python", Install: reqs,
			Run: "python manage.py runserver 0.0.0.0:{port}", Ports: []int{8000}}
	case (deps["fastapi"] || deps["uvicorn"]) && appModule(root) != "":
		return &Runfile{Source: "python", Install: reqs,
			Run: "uvicorn " + appModule(root) + ":app --host 0.0.0.0 --port {port}", Ports: []int{8000}}
	case deps["flask"] && fileExists(root, "app.py"):
		return &Runfile{Source: "python", Install: reqs,
			Run: "flask --app app run --port {port}", Ports: []int{5000}}
	}
	return nil
}

func pythonDeps(root string) map[string]bool {
	deps := map[string]bool{}
	for _, name := range []string{"requirements.txt", "pyproject.toml"} {
		data, err := os.ReadFile(filepath.Join(root, name))
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

// appModule guesses the uvicorn module: main.py or app.py at root.
func appModule(root string) string {
	for _, mod := range []string{"main", "app"} {
		if fileExists(root, mod+".py") {
			return mod
		}
	}
	return ""
}

func fileExists(root, name string) bool {
	_, err := os.Stat(filepath.Join(root, name))
	return err == nil
}

/* ---------- SHA-keyed cache ---------- */

func cachePath(sha string) (string, error) {
	if sha == "" {
		return "", fmt.Errorf("empty commit SHA")
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cache, "terra", "runfiles", sha+".json"), nil
}

// Load returns the cached Runfile for a commit, or nil when never inferred.
func Load(sha string) *Runfile {
	path, err := cachePath(sha)
	if err != nil {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var rf Runfile
	if json.Unmarshal(data, &rf) != nil {
		return nil
	}
	return &rf
}

// Save caches a Runfile under its commit SHA. Best-effort: a failed write
// only costs a re-inference.
func Save(sha string, rf *Runfile) {
	path, err := cachePath(sha)
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	data, _ := json.Marshal(rf)
	os.WriteFile(path, data, 0o644)
}

// For returns the Runfile for a checkout at one commit, from cache or fresh
// inference. sha may be "" (no caching then).
func For(root, sha string) (*Runfile, error) {
	if rf := Load(sha); rf != nil {
		return rf, nil
	}
	rf, err := Infer(root)
	if err != nil {
		return nil, err
	}
	if sha != "" {
		Save(sha, rf)
	}
	return rf, nil
}
