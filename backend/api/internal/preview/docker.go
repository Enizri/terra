package preview

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Enizri/terra/backend/api/internal/appgraph"
	"github.com/Enizri/terra/backend/api/internal/config"
	"github.com/Enizri/terra/backend/api/internal/scan"
)

const dockerPreviewPort = 5173

// dockerDefault is the process-wide Docker sibling preview runner.
var dockerDefault = &dockerRunner{byRepo: map[string]*instance{}}

// Docker returns the process-local Docker sibling preview runner, configured with c.
func Docker(c *config.Config) Runner {
	dockerDefault.mu.Lock()
	dockerDefault.cfg = c
	dockerDefault.mu.Unlock()
	return dockerDefault
}

type dockerRunner struct {
	mu     sync.Mutex
	cfg    *config.Config
	byRepo map[string]*instance
	boots  map[string]*bootWait
	// starting tracks containers owned by an in-flight boot so StopAll can
	// remove them before they land in byRepo.
	starting map[string]*instance
}

func (r *dockerRunner) Start(repoURL string) (string, error) {
	key, _, err := scan.NormalizeURL(repoURL)
	if err != nil {
		return "", err
	}
	for {
		r.mu.Lock()
		ttl := time.Duration(0)
		limit := previewLimit(r.cfg)
		cfg := r.cfg
		if cfg != nil {
			ttl = cfg.PreviewTTL
		}

		if inst, ok := r.byRepo[key]; ok {
			publicURL := inst.proxyURL
			r.mu.Unlock()
			if inst.healthy() {
				r.mu.Lock()
				if cur, ok := r.byRepo[key]; ok && cur == inst {
					r.resetTTLLocked(key, inst, ttl)
					r.mu.Unlock()
					if p := inst.primaryApp(); p != nil {
						fmt.Fprintf(os.Stderr, "preview: reusing %s, ttl reset to %s\n", p.containerName, ttl)
					}
					return publicURL, nil
				}
				r.mu.Unlock()
				continue
			}
			r.mu.Lock()
			if cur, ok := r.byRepo[key]; ok && cur == inst {
				r.stopLocked(inst)
				delete(r.byRepo, key)
			}
		}

		if ch, ok := r.boots[key]; ok {
			r.mu.Unlock()
			<-ch.done
			continue
		}

		used := usedApps(r.byRepo, r.boots)
		if limit >= 0 && used >= limit {
			fmt.Fprintf(os.Stderr, "preview: rejected %s, capacity full (%d/%d apps)\n", key, used, limit)
			r.mu.Unlock()
			return "", fmt.Errorf("preview capacity full (%d apps / %d); stop another preview or raise TERRA_PREVIEW_MAX", used, limit)
		}
		if r.boots == nil {
			r.boots = map[string]*bootWait{}
		}
		wait := &bootWait{done: make(chan struct{})}
		r.boots[key] = wait
		r.mu.Unlock()

		url, err := r.runBoot(key, cfg, ttl, limit, wait)
		return url, err
	}
}

func (r *dockerRunner) runBoot(key string, cfg *config.Config, ttl time.Duration, limit int, wait *bootWait) (url string, err error) {
	var inst *instance
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("docker preview boot panicked: %v", rec)
			inst = nil
		}
		r.mu.Lock()
		if err == nil && inst != nil {
			r.resetTTLLocked(key, inst, ttl)
			r.byRepo[key] = inst
			name := key
			if p := inst.primaryApp(); p != nil && p.containerName != "" {
				name = p.containerName
			}
			fmt.Fprintf(os.Stderr, "preview: started %s at %s (ttl %s, %d/%d apps)\n",
				name, inst.proxyURL, ttl, usedApps(r.byRepo, r.boots), limit)
		} else {
			if inst != nil {
				r.stopLocked(inst)
			} else if partial := r.starting[key]; partial != nil {
				r.stopLocked(partial)
			}
		}
		delete(r.starting, key)
		delete(r.boots, key)
		close(wait.done)
		r.mu.Unlock()
	}()
	url, inst, err = r.boot(key, cfg)
	return url, err
}

func (r *dockerRunner) trackStarting(key string, inst *instance) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.starting == nil {
		r.starting = map[string]*instance{}
	}
	r.starting[key] = inst
}

func (r *dockerRunner) reserveApps(key string, n int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if b, ok := r.boots[key]; ok {
		b.apps = n
	}
	limit := previewLimit(r.cfg)
	used := usedApps(r.byRepo, r.boots)
	if limit >= 0 && used > limit {
		return fmt.Errorf("preview capacity full (%d apps / %d); stop another preview or raise TERRA_PREVIEW_MAX", used, limit)
	}
	return nil
}

func (r *dockerRunner) boot(key string, cfg *config.Config) (string, *instance, error) {
	root, err := scan.Checkout(cfg.CheckoutDir, key)
	if err != nil {
		return "", nil, err
	}
	apps, err := appgraph.For(root, scan.CheckoutCommit(root))
	if err != nil {
		inst, err := bootRunfile(cfg, key, root, err)
		if err != nil {
			return "", nil, err
		}
		r.trackStarting(key, inst)
		if err := r.reserveApps(key, 1); err != nil {
			inst.stop(r.dockerBin())
			return "", nil, err
		}
		return inst.proxyURL, inst, nil
	}
	order := bootOrder(apps)
	if len(order) == 0 {
		return "", nil, noPreviewable(root, apps)
	}
	if err := r.reserveApps(key, len(order)); err != nil {
		return "", nil, err
	}

	needsDocker := false
	for _, app := range order {
		if dockerable(app) {
			needsDocker = true
			break
		}
	}
	dockerBin := ""
	if needsDocker {
		dockerBin = cfg.DockerBin
		if _, err := exec.LookPath(dockerBin); err != nil {
			return "", nil, fmt.Errorf("docker preview: %q not found on PATH (set TERRA_DOCKER): %w", dockerBin, err)
		}
		hookPath := filepath.Join(root, ".terra-hook.js")
		if err := os.WriteFile(hookPath, hookJS, 0o644); err != nil {
			return "", nil, err
		}
	}

	primary, _ := appgraph.Primary(apps)
	inst := &instance{root: root}
	r.trackStarting(key, inst)

	var extraEnv []string
	var apiProc *appProcess
	for _, app := range order {
		var proc *appProcess
		if dockerable(app) {
			proc, err = r.startDockerApp(cfg, dockerBin, key, root, app, primary.ID, extraEnv)
		} else {
			port, perr := freePort()
			if perr != nil {
				inst.stop(dockerBin)
				return "", nil, perr
			}
			spec := specFor(app.Framework)
			liveID := appLiveID(key, app.ID, app.ID == primary.ID)
			opts := launch{Port: port}
			if spec.SupportsBasePath {
				opts.BasePath = "/__live/" + liveID + "/"
			}
			proc, err = startHostApp(cfg, key, root, app, opts, extraEnv)
			if err == nil {
				proc.liveID = liveID
				proc.primary = app.ID == primary.ID
				bound, werr := waitReady(port, proc.logs, watch(proc.cmd), readyBudget(app), skipPorts(inst.apps)...)
				if werr != nil {
					proc.stop(dockerBin)
					err = fmt.Errorf("%s never came up: %v\n--- output ---\n%s", app.ID, werr, proc.logs.String())
				} else {
					proc.port = bound
					proc.target = "http://localhost:" + strconv.Itoa(bound)
					proc.readyURL = proc.target + "/"
					err = publishApp(cfg, key, proc, spec, true, seedDemoAuth(key, proc.target))
				}
			}
		}
		if err != nil {
			inst.stop(dockerBin)
			return "", nil, err
		}
		inst.apps = append(inst.apps, proc)
		if app.Kind == appgraph.KindAPI && apiProc == nil {
			apiProc = proc
			extraEnv = apiProxyEnv(proc.dockerAPIOrigin(cfg))
		}
	}
	p := inst.primaryApp()
	if p == nil {
		inst.stop(dockerBin)
		return "", nil, fmt.Errorf("preview boot produced no apps")
	}
	inst.proxyURL = p.publicURL
	return inst.proxyURL, inst, nil
}

func (r *dockerRunner) startDockerApp(cfg *config.Config, dockerBin, key, root string, app appgraph.App, primaryID string, extraEnv []string) (*appProcess, error) {
	liveID := appLiveID(key, app.ID, app.ID == primaryID)
	name := "terra-preview-" + liveID
	_ = exec.Command(dockerBin, "rm", "-f", name).Run()

	spec := specFor(app.Framework)
	basePath := ""
	if spec.SupportsBasePath {
		basePath = "/__live/" + liveID + "/"
	}
	opts := launch{Port: dockerPreviewPort, BasePath: basePath, AllHosts: true}
	hookPath := filepath.Join(root, ".terra-hook.js")
	appDir := appWorkDir(root, app)

	args := []string{"run", "-d", "--name", name}
	args = append(args, dockerMountArgs(cfg, root)...)
	args = append(args,
		"-w", appDir,
		"-e", "BROWSER=none",
		"-e", "NODE_OPTIONS=--require "+hookPath,
	)
	for _, kv := range append(spec.environ(opts), extraEnv...) {
		args = append(args, "-e", kv)
	}
	for _, kv := range dockerTraceVars(cfg, key) {
		args = append(args, "-e", kv)
	}
	network := cfg.PreviewNetwork
	if network != "" {
		args = append(args, "--network", network)
	} else {
		args = append(args, "-p", "127.0.0.1::"+strconv.Itoa(dockerPreviewPort))
	}
	args = append(args, cfg.PreviewImage, "bash", "-lc", dockerAppCommand(app, spec, opts))

	out, err := exec.Command(dockerBin, args...).CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("docker run preview (%s): %v: %s", app.ID, err, tail(out))
	}

	target, err := r.resolveTarget(dockerBin, name, network)
	if err != nil {
		_ = exec.Command(dockerBin, "rm", "-f", name).Run()
		return nil, err
	}
	readyURL := strings.TrimRight(target, "/") + "/"
	if basePath != "" {
		readyURL = strings.TrimRight(target, "/") + basePath
	}
	if err := waitURLReady(readyURL, 3*time.Minute); err != nil {
		logs, _ := exec.Command(dockerBin, "logs", "--tail", "80", name).CombinedOutput()
		_ = exec.Command(dockerBin, "rm", "-f", name).Run()
		return nil, fmt.Errorf("preview container never became ready (%s): %v\n--- docker logs ---\n%s", app.ID, err, tail(logs))
	}

	proc := &appProcess{
		id: app.ID, dir: appDir, kind: app.Kind, framework: app.Framework,
		containerName: name, port: dockerPreviewPort, target: target,
		readyURL: readyURL, liveID: liveID, primary: app.ID == primaryID,
	}
	authFix := seedDemoAuth(key, target)
	if err := publishApp(cfg, key, proc, spec, spec.SupportsBasePath, authFix); err != nil {
		_ = exec.Command(dockerBin, "rm", "-f", name).Run()
		return nil, err
	}
	return proc, nil
}

func dockerAppCommand(app appgraph.App, spec launchSpec, opts launch) string {
	if pm, script, ok := nodeRun(app.Run); ok {
		return dockerDevCommand(pm, script, spec, opts)
	}
	prefix := ""
	if strings.HasPrefix(app.Install, "pnpm ") || strings.HasPrefix(app.Install, "yarn ") {
		prefix = "corepack enable && "
	}
	install := app.Install
	if install == "" {
		install = "true"
	}
	run := strings.ReplaceAll(app.Run, "{port}", strconv.Itoa(opts.Port))
	if flags := spec.args(opts); len(flags) > 0 && !strings.Contains(app.Run, "{port}") {
		run += " " + strings.Join(flags, " ")
	}
	return prefix + install + " && " + run
}

func (r *dockerRunner) dockerBin() string {
	if r.cfg == nil || r.cfg.DockerBin == "" {
		return "docker"
	}
	return r.cfg.DockerBin
}

func (r *dockerRunner) Restart(repoURL string) error {
	key, _, err := scan.NormalizeURL(repoURL)
	if err != nil {
		return err
	}
	for {
		r.mu.Lock()
		if ch, ok := r.boots[key]; ok {
			r.mu.Unlock()
			<-ch.done
			continue
		}
		if inst, ok := r.byRepo[key]; ok {
			r.stopLocked(inst)
			delete(r.byRepo, key)
		}
		r.mu.Unlock()
		break
	}
	_, err = r.Start(repoURL)
	return err
}

func (r *dockerRunner) Lookup(repoURL string) (root, appDir string, ok bool) {
	key, _, err := scan.NormalizeURL(repoURL)
	if err != nil {
		return "", "", false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	inst, ok := r.byRepo[key]
	if !ok {
		return "", "", false
	}
	return inst.root, inst.appDir(), true
}

func (r *dockerRunner) StopAll() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for key, inst := range r.starting {
		r.stopLocked(inst)
		delete(r.starting, key)
	}
	for key, inst := range r.byRepo {
		r.stopLocked(inst)
		delete(r.byRepo, key)
	}
}

func (r *dockerRunner) stopLocked(inst *instance) {
	bin := r.dockerBin()
	inst.stop(bin)
	if inst != nil && len(inst.apps) > 0 {
		fmt.Fprintf(os.Stderr, "preview: stopped %s\n", inst.apps[0].containerName)
	}
}

func (r *dockerRunner) resetTTLLocked(key string, inst *instance, ttl time.Duration) {
	if ttl <= 0 || inst == nil {
		return
	}
	if inst.timer != nil {
		inst.timer.Reset(ttl)
		return
	}
	inst.timer = time.AfterFunc(ttl, func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		cur, ok := r.byRepo[key]
		if !ok || cur != inst {
			return
		}
		fmt.Fprintf(os.Stderr, "preview: idle %s expired, stopping %s\n", ttl, key)
		r.stopLocked(inst)
		delete(r.byRepo, key)
	})
}

// inContainer reports whether this process runs inside a Docker container.
func inContainer() bool {
	_, err := os.Stat("/.dockerenv")
	return err == nil
}

func (r *dockerRunner) resolveTarget(dockerBin, name, network string) (string, error) {
	if network != "" {
		return fmt.Sprintf("http://%s:%d", name, dockerPreviewPort), nil
	}
	out, err := exec.Command(dockerBin, "port", name, strconv.Itoa(dockerPreviewPort)+"/tcp").CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("docker port: %v: %s", err, tail(out))
	}
	// e.g. "127.0.0.1:49153"
	line := strings.TrimSpace(string(out))
	if i := strings.LastIndex(line, ":"); i >= 0 {
		hostPort := strings.TrimSpace(line[i+1:])
		if hostPort != "" {
			gateway := r.cfg.TraceHost
			if gateway == "" {
				// The published port lives on the Docker host. From inside a
				// container that's host.docker.internal; from a Terra process
				// running directly on the host it's plain loopback — the
				// container-only name resolves nowhere there (and never on
				// plain Linux), burning the whole ready-wait budget.
				if inContainer() {
					gateway = "host.docker.internal"
				} else {
					gateway = "127.0.0.1"
				}
			}
			return fmt.Sprintf("http://%s:%s", gateway, hostPort), nil
		}
	}
	return "", fmt.Errorf("docker port: unexpected output %q", line)
}

// dockerMountArgs returns -v flags so the checkout is visible inside the sibling.
// Prefer a named volume (Compose) or host bind remap — Docker Desktop resolves
// -v against the host, so API-container paths like /data/... cannot be remounted as-is.
func dockerMountArgs(c *config.Config, root string) []string {
	if c.CheckoutVolume != "" {
		return []string{"-v", c.CheckoutVolume + ":/data"}
	}
	if c.HostCheckoutDir != "" {
		src := root
		if c.CheckoutDir != "" {
			if rel, err := filepath.Rel(c.CheckoutDir, root); err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				src = filepath.Join(c.HostCheckoutDir, rel)
			}
		}
		return []string{"-v", src + ":" + root}
	}
	return []string{"-v", root + ":" + root}
}

// dockerDevCommand is the install-then-run line the sibling container executes.
// The flags come from the framework's spec: a dev server in a container has to
// bind every interface, and only some of them can be told a base path.
func dockerDevCommand(pm, script string, spec launchSpec, opts launch) string {
	prefix := ""
	switch pm {
	case "pnpm", "yarn":
		// node images ship corepack; enable the lockfile's package manager.
		prefix = "corepack enable && "
	}
	return fmt.Sprintf("%s%s install && %s", prefix, pm, scriptCommand(pm, script, spec.args(opts)))
}

var safeKeyRe = regexp.MustCompile(`[^a-zA-Z0-9_.-]+`)

func safeContainerKey(repoKey string) string {
	s := strings.TrimPrefix(repoKey, "https://")
	s = strings.TrimPrefix(s, "http://")
	s = safeKeyRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 48 {
		s = s[:48]
	}
	if s == "" {
		s = "preview"
	}
	return strings.ToLower(s)
}

func aliveURL(base string) bool {
	return waitURLReady(strings.TrimRight(base, "/")+"/", 2*time.Second) == nil
}

func waitURLReady(rawURL string, budget time.Duration) error {
	// Do not follow redirects: Vite --base may 302 "/" to the base path.
	client := &http.Client{
		Timeout: 2 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	deadline := time.Now().Add(budget)
	for time.Now().Before(deadline) {
		resp, err := client.Get(rawURL)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode < 500 {
				return nil
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("timed out after %s waiting for %s", budget, rawURL)
}
