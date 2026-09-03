package preview

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Enizri/terra/backend/api/internal/appgraph"
	"github.com/Enizri/terra/backend/api/internal/config"
)

// appProcess is one booted app inside a previewed repository.
type appProcess struct {
	id            string
	dir           string // absolute working directory
	kind          appgraph.Kind
	framework     string
	cmd           *exec.Cmd
	logs          *boundedBuf
	containerName string
	port          int
	target        string
	readyURL      string
	liveID        string
	publicURL     string
	proxyLn       net.Listener // set when the app is served at its own origin
	primary       bool
}

// AppInfo is one app in a POST /preview (or jobs/preview ready) payload.
type AppInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Framework string `json:"framework"`
	URL       string `json:"url,omitempty"`
	Status    string `json:"status"`
	Reason    string `json:"reason,omitempty"`
}

// Result is the multi-app preview response. URL is the primary app, kept
// for clients that still read only that field.
type Result struct {
	URL       string    `json:"url"`
	PrimaryID string    `json:"primary_id"`
	Apps      []AppInfo `json:"apps"`
}

// Emitter is optional boot progress (checkout → detect → install → boot → ready).
type Emitter func(stage, label string)

func ping(emit Emitter, stage, label string) {
	if emit != nil {
		emit(stage, label)
	}
}

func appName(app appgraph.App) string {
	if app.Dir != "" && app.Dir != "." {
		return app.Dir
	}
	if app.Framework != "" {
		return app.Framework
	}
	return app.ID
}

func snapshot(inst *instance) Result {
	if inst == nil {
		return Result{}
	}
	byID := map[string]*appProcess{}
	for _, p := range inst.apps {
		byID[p.id] = p
	}
	primaryID := inst.primaryID
	if primaryID == "" {
		if p := inst.primaryApp(); p != nil {
			primaryID = p.id
		}
	}
	var apps []AppInfo
	if len(inst.graph) > 0 {
		for _, g := range inst.graph {
			info := AppInfo{
				ID: g.ID, Name: appName(g), Kind: string(g.Kind),
				Framework: g.Framework, Status: "skipped", Reason: g.Reason,
			}
			if p, ok := byID[g.ID]; ok && p.publicURL != "" {
				info.URL = p.publicURL
				info.Status = "ready"
				info.Reason = ""
			} else {
				switch {
				case g.Kind == appgraph.KindLibrary || g.Kind == appgraph.KindCLI:
					info.Status = "ready"
				case !g.Previewable:
					info.Status = "skipped"
				default:
					info.Status = "error"
				}
			}
			apps = append(apps, info)
		}
	} else {
		for _, p := range inst.apps {
			apps = append(apps, AppInfo{
				ID: p.id, Name: p.id, Kind: string(p.kind),
				Framework: p.framework, URL: p.publicURL, Status: "ready",
			})
		}
	}
	return Result{URL: inst.proxyURL, PrimaryID: primaryID, Apps: apps}
}

// instance is one previewed repository: every app Terra booted for it.
type instance struct {
	root      string
	apps      []*appProcess
	graph     []appgraph.App
	primaryID string
	proxyURL  string
	timer     *time.Timer
	// staged is a non-HTTP live view (library README). No child process.
	staged bool
}

// bootWait is an in-flight Start. apps is 0 until detect finishes, then the
// number of previewable apps this boot will occupy — capacity counts apps,
// not repositories.
type bootWait struct {
	done chan struct{}
	apps int
}

func (inst *instance) primaryApp() *appProcess {
	if inst == nil {
		return nil
	}
	for _, p := range inst.apps {
		if p.primary {
			return p
		}
	}
	if len(inst.apps) > 0 {
		return inst.apps[0]
	}
	return nil
}

func (inst *instance) appDir() string {
	if inst != nil && inst.staged {
		return inst.root
	}
	if p := inst.primaryApp(); p != nil && p.dir != "" {
		return p.dir
	}
	if inst != nil {
		return inst.root
	}
	return ""
}

func (inst *instance) healthy() bool {
	if inst != nil && inst.staged {
		return true
	}
	p := inst.primaryApp()
	if p == nil {
		return false
	}
	if p.readyURL != "" {
		return aliveURL(p.readyURL)
	}
	return alive(p.port)
}

func (inst *instance) stop(dockerBin string) {
	if inst == nil {
		return
	}
	if inst.timer != nil {
		inst.timer.Stop()
		inst.timer = nil
	}
	for _, p := range inst.apps {
		p.stop(dockerBin)
	}
}

func (p *appProcess) stop(dockerBin string) {
	if p == nil {
		return
	}
	stop(p.cmd)
	if p.liveID != "" {
		UnmountPathProxy(p.liveID)
	}
	if p.proxyLn != nil {
		p.proxyLn.Close()
		p.proxyLn = nil
	}
	if dockerBin != "" && p.containerName != "" {
		_ = exec.Command(dockerBin, "rm", "-f", p.containerName).Run()
	}
}

// bootOrder is DependsOn-first: APIs (no deps) before the web apps that read
// their URL at process start.
func bootOrder(apps []appgraph.App) []appgraph.App {
	var ready, later []appgraph.App
	for _, app := range apps {
		if !app.Previewable {
			continue
		}
		if len(app.DependsOn) == 0 {
			ready = append(ready, app)
		} else {
			later = append(later, app)
		}
	}
	return append(ready, later...)
}

// apiProxyEnv is what every non-API app gets so Vite/Next/CRA all see the
// primary API, not just memos' DEV_PROXY_SERVER.
func apiProxyEnv(apiURL string) []string {
	return []string{
		"DEV_PROXY_SERVER=" + apiURL,
		"API_URL=" + apiURL,
		"VITE_API_URL=" + apiURL,
		"NEXT_PUBLIC_API_URL=" + apiURL,
	}
}

// appLiveID is stable across restarts so LiveFrame's iframe, which only
// re-runs on repoUrl, keeps pointing at a live listener.
func appLiveID(repoKey, appID string, primary bool) string {
	base := safeContainerKey(repoKey)
	if primary {
		return base
	}
	id := base + "-" + safeContainerKey(appID)
	if len(id) > 48 {
		id = id[:48]
	}
	return strings.Trim(id, "-")
}

func appWorkDir(root string, app appgraph.App) string {
	if app.Dir == "" || app.Dir == "." {
		return root
	}
	return filepath.Join(root, filepath.FromSlash(app.Dir))
}

// nodeRun pulls a package-manager script out of App.Run so launch flags can
// be appended as argv instead of being interpolated into a shell string.
func nodeRun(run string) (pm, script string, ok bool) {
	fields := strings.Fields(run)
	if len(fields) >= 3 && fields[1] == "run" {
		switch fields[0] {
		case "npm", "pnpm", "yarn":
			return fields[0], fields[2], true
		}
	}
	return "", "", false
}

func pythonish(framework string) bool {
	switch framework {
	case "django", "fastapi", "flask", "python":
		return true
	}
	return false
}

// dockerable is true when the app can run in the Node sibling image. Go,
// Python and Flutter stay on the host — the default preview image has none
// of those toolchains.
func dockerable(app appgraph.App) bool {
	if _, _, ok := nodeRun(app.Run); ok {
		return true
	}
	switch app.Framework {
	case "vite", "next", "cra", "angular", "sveltekit", "astro", "nuxt", "remix",
		"expo", "electron", "tauri", "nest", "express", "fastify", "node":
		return true
	}
	inst := app.Install
	return strings.HasPrefix(inst, "npm ") || strings.HasPrefix(inst, "pnpm ") || strings.HasPrefix(inst, "yarn ")
}

func usedApps(byRepo map[string]*instance, boots map[string]*bootWait) int {
	n := 0
	for _, inst := range byRepo {
		n += len(inst.apps)
	}
	for _, b := range boots {
		if b == nil {
			continue
		}
		if b.apps > 0 {
			n += b.apps
		} else {
			n++
		}
	}
	return n
}

func previewLimit(cfg *config.Config) int {
	if cfg == nil {
		return 2
	}
	return cfg.PreviewMax
}

// packageStage is the live view when nothing HTTP-bootable exists: the
// checkout stays mounted so GET /files can show README and the tree.
func packageStage(root string, apps []appgraph.App) *instance {
	if len(apps) == 0 {
		apps = []appgraph.App{{
			ID: "repo", Dir: ".", Kind: appgraph.KindLibrary,
			Reason: "Terra found no app to boot. Showing the repository instead.",
		}}
	}
	id := apps[0].ID
	if p, ok := appgraph.Primary(apps); ok {
		id = p.ID
	} else {
		for _, a := range apps {
			if a.Kind == appgraph.KindLibrary || a.Kind == appgraph.KindCLI {
				id = a.ID
				break
			}
		}
	}
	return &instance{root: root, graph: apps, primaryID: id, staged: true}
}

func installApp(root string, app appgraph.App) error {
	if app.Install == "" {
		return nil
	}
	dir := appWorkDir(root, app)
	fields := strings.Fields(app.Install)
	if len(fields) >= 2 && fields[1] == "install" {
		switch fields[0] {
		case "npm", "pnpm", "yarn":
			if _, err := os.Stat(filepath.Join(dir, "node_modules")); err == nil {
				return nil
			}
		}
	}
	shell := app.Install
	var extra []string
	if pythonish(app.Framework) {
		shell = "python3 -m venv .terra-venv && " + app.Install
		extra = []string{venvPath(dir)}
	}
	cmd := exec.Command("/bin/sh", "-c", shell)
	cmd.Dir = dir
	cmd.Env = append(childEnv(), extra...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%s in %s: %v: %s", app.Install, dir, err, tail(out))
	}
	return nil
}

func startHostApp(cfg *config.Config, key, root string, app appgraph.App, opts launch, extraEnv []string) (*appProcess, error) {
	dir := appWorkDir(root, app)
	if err := installApp(root, app); err != nil {
		return nil, err
	}
	spec := specFor(app.Framework)
	logs := &boundedBuf{}
	var cmd *exec.Cmd
	if pm, script, ok := nodeRun(app.Run); ok {
		cmd = exec.Command(pm, scriptArgs(pm, script, spec.args(opts))...)
	} else {
		shell := strings.ReplaceAll(app.Run, "{port}", strconv.Itoa(opts.Port))
		if flags := spec.args(opts); len(flags) > 0 && !strings.Contains(app.Run, "{port}") {
			shell += " " + strings.Join(flags, " ")
		}
		cmd = exec.Command("/bin/sh", "-c", shell)
	}
	cmd.Dir = dir
	cmd.Env = append(childEnv(), spec.environ(opts)...)
	cmd.Env = append(cmd.Env, extraEnv...)
	cmd.Env = append(cmd.Env, "BROWSER=none")
	if pythonish(app.Framework) {
		cmd.Env = append(cmd.Env, venvPath(dir))
	}
	if cfg != nil && !pythonish(app.Framework) && app.Framework != "go" && app.Framework != "flutter" {
		cmd.Env = append(cmd.Env, traceEnv(cfg, key)...)
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Stdout = logs
	cmd.Stderr = logs
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start %s (%s): %w", app.ID, app.Run, err)
	}
	return &appProcess{
		id:        app.ID,
		dir:       dir,
		kind:      app.Kind,
		framework: app.Framework,
		cmd:       cmd,
		logs:      logs,
		port:      opts.Port,
	}, nil
}

func readyBudget(app appgraph.App) time.Duration {
	switch app.Framework {
	case "go", "django", "fastapi", "flask", "python", "flutter":
		return 5 * time.Minute
	}
	return 2 * time.Minute
}

func skipPorts(apps []*appProcess) []int {
	var ports []int
	for _, p := range apps {
		if p.port != 0 {
			ports = append(ports, p.port)
		}
	}
	return ports
}

func publishApp(cfg *config.Config, key string, p *appProcess, spec launchSpec, pathMount bool, authFix func(*http.Request)) error {
	publicBase := "http://127.0.0.1:8080"
	if cfg != nil {
		publicBase = cfg.PublicBase()
	}
	if pathMount {
		// Strip the /__live/{id} prefix when the framework cannot be told a
		// base path, so a Go API still sees "/" rather than the mount.
		url, err := mountPathProxy(publicBase, p.liveID, p.target, key, authFix, !spec.SupportsBasePath)
		p.publicURL = url
		return err
	}
	url, ln, err := serveProxy(key, p.target, authFix)
	p.publicURL = url
	p.proxyLn = ln
	return err
}

// dockerAPIOrigin is the URL a sibling container should use to reach this
// process: container DNS when both are on TERRA_PREVIEW_NETWORK, otherwise
// the host gateway, because 127.0.0.1 inside the frontend container is not
// the API.
func (p *appProcess) dockerAPIOrigin(cfg *config.Config) string {
	if p.containerName != "" && cfg != nil && cfg.PreviewNetwork != "" {
		return fmt.Sprintf("http://%s:%d", p.containerName, dockerPreviewPort)
	}
	if p.containerName != "" {
		return strings.TrimRight(p.target, "/")
	}
	host := "host.docker.internal"
	if cfg != nil && cfg.TraceHost != "" {
		host = cfg.TraceHost
	}
	return fmt.Sprintf("http://%s:%d", host, p.port)
}
