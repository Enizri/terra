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

	"github.com/Enizri/terra/internal/config"
	"github.com/Enizri/terra/internal/scan"
)

const dockerPreviewPort = 5173

// dockerDefault is the process-wide Docker sibling preview runner.
var dockerDefault = &dockerRunner{byRepo: map[string]*dockerInstance{}}

// Docker returns the process-local Docker sibling preview runner, configured with c.
func Docker(c *config.Config) Runner {
	dockerDefault.mu.Lock()
	dockerDefault.cfg = c
	dockerDefault.mu.Unlock()
	return dockerDefault
}

type dockerInstance struct {
	root          string
	appDir        string
	containerName string
	publicURL     string
	target        string
	readyURL      string
	liveID        string
	timer         *time.Timer
}

type dockerRunner struct {
	mu     sync.Mutex
	cfg    *config.Config
	byRepo map[string]*dockerInstance
	boots  map[string]chan struct{} // in-flight boots; closed when done
	// starting tracks containers owned by an in-flight boot so StopAll can
	// remove them before they land in byRepo.
	starting map[string]*dockerInstance
}

func (r *dockerRunner) Start(repoURL string) (string, error) {
	key, _, err := scan.NormalizeURL(repoURL)
	if err != nil {
		return "", err
	}
	for {
		r.mu.Lock()
		ttl := r.cfg.PreviewTTL
		max := r.cfg.PreviewMax
		cfg := r.cfg

		if inst, ok := r.byRepo[key]; ok {
			check := inst.readyURL
			if check == "" {
				check = inst.target
			}
			publicURL := inst.publicURL
			name := inst.containerName
			r.mu.Unlock()
			if aliveURL(check) {
				r.mu.Lock()
				if cur, ok := r.byRepo[key]; ok && cur == inst {
					r.resetTTLLocked(key, inst, ttl)
					r.mu.Unlock()
					fmt.Fprintf(os.Stderr, "preview: reusing %s, ttl reset to %s\n", name, ttl)
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
			<-ch
			continue
		}

		inflight := len(r.byRepo) + len(r.boots)
		if max >= 0 && inflight >= max {
			fmt.Fprintf(os.Stderr, "preview: rejected %s, capacity full (%d/%d)\n", key, len(r.byRepo), max)
			r.mu.Unlock()
			return "", fmt.Errorf("preview capacity full (%d concurrent); stop another preview or raise TERRA_PREVIEW_MAX", max)
		}
		if r.boots == nil {
			r.boots = map[string]chan struct{}{}
		}
		ch := make(chan struct{})
		r.boots[key] = ch
		r.mu.Unlock()

		url, err := r.runBoot(key, cfg, ttl, max, ch)
		return url, err
	}
}

// runBoot runs the heavy docker work outside the mutex and always clears boots.
func (r *dockerRunner) runBoot(key string, cfg *config.Config, ttl time.Duration, max int, ch chan struct{}) (url string, err error) {
	var inst *dockerInstance
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("docker preview boot panicked: %v", rec)
			inst = nil
		}
		r.mu.Lock()
		if err == nil && inst != nil {
			r.resetTTLLocked(key, inst, ttl)
			r.byRepo[key] = inst
			fmt.Fprintf(os.Stderr, "preview: started %s at %s (ttl %s, %d/%d slots)\n",
				inst.containerName, inst.publicURL, ttl, len(r.byRepo), max)
		} else {
			if inst != nil {
				r.stopLocked(inst)
			} else if partial := r.starting[key]; partial != nil {
				r.stopLocked(partial)
			}
		}
		delete(r.starting, key)
		delete(r.boots, key)
		close(ch)
		r.mu.Unlock()
	}()
	url, inst, err = r.boot(key, cfg)
	return url, err
}

func (r *dockerRunner) trackStarting(key string, inst *dockerInstance) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.starting == nil {
		r.starting = map[string]*dockerInstance{}
	}
	r.starting[key] = inst
}

// boot does checkout + docker run + ready-wait. It must not hold r.mu.
func (r *dockerRunner) boot(key string, cfg *config.Config) (string, *dockerInstance, error) {
	dockerBin := cfg.DockerBin
	if _, err := exec.LookPath(dockerBin); err != nil {
		return "", nil, fmt.Errorf("docker preview: %q not found on PATH (set TERRA_DOCKER): %w", dockerBin, err)
	}

	root, err := scan.Checkout(cfg.CheckoutDir, key)
	if err != nil {
		return "", nil, err
	}
	appDir, script, pm, err := detect(root)
	if err != nil {
		return "", nil, fmt.Errorf("docker preview supports package.json frontends only (use TERRA_PREVIEW_MODE=host for runfile/Go): %v", err)
	}

	liveID := safeContainerKey(key)
	name := "terra-preview-" + liveID
	_ = exec.Command(dockerBin, "rm", "-f", name).Run()

	// Write hook into the checkout so sibling containers see it via the shared
	// volume/bind (API image paths are not host-visible to Docker Desktop).
	hookPath := filepath.Join(root, ".terra-hook.js")
	if err := os.WriteFile(hookPath, hookJS, 0o644); err != nil {
		return "", nil, err
	}

	image := cfg.PreviewImage
	network := cfg.PreviewNetwork

	args := []string{"run", "-d", "--name", name}
	args = append(args, dockerMountArgs(cfg, root)...)
	args = append(args,
		"-w", appDir,
		"-e", "PORT="+strconv.Itoa(dockerPreviewPort),
		"-e", "BROWSER=none",
		"-e", "NODE_OPTIONS=--require "+hookPath,
	)
	for _, kv := range dockerTraceVars(cfg, key) {
		args = append(args, "-e", kv)
	}
	if network != "" {
		args = append(args, "--network", network)
	} else {
		args = append(args, "-p", "127.0.0.1::"+strconv.Itoa(dockerPreviewPort))
	}
	basePath := "/__live/" + liveID + "/"
	args = append(args, image, "bash", "-lc", dockerDevCommand(pm, script, basePath))

	out, err := exec.Command(dockerBin, args...).CombinedOutput()
	if err != nil {
		return "", nil, fmt.Errorf("docker run preview: %v: %s", err, tail(out))
	}
	partial := &dockerInstance{containerName: name, liveID: liveID}
	r.trackStarting(key, partial)

	target, err := r.resolveTarget(dockerBin, name, network)
	if err != nil {
		_ = exec.Command(dockerBin, "rm", "-f", name).Run()
		return "", nil, err
	}
	readyURL := strings.TrimRight(target, "/") + basePath
	if err := waitURLReady(readyURL, 3*time.Minute); err != nil {
		logs, _ := exec.Command(dockerBin, "logs", "--tail", "80", name).CombinedOutput()
		_ = exec.Command(dockerBin, "rm", "-f", name).Run()
		return "", nil, fmt.Errorf("preview container never became ready: %v\n--- docker logs ---\n%s", err, tail(logs))
	}

	authFix := seedDemoAuth(key, target)
	publicURL, err := MountPathProxy(cfg.PublicBase(), liveID, target, key, authFix)
	if err != nil {
		_ = exec.Command(dockerBin, "rm", "-f", name).Run()
		return "", nil, err
	}

	inst := &dockerInstance{
		root: root, appDir: appDir, containerName: name,
		publicURL: publicURL, target: target, readyURL: readyURL, liveID: liveID,
	}
	return publicURL, inst, nil
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
	return inst.root, inst.appDir, true
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

func (r *dockerRunner) stopLocked(inst *dockerInstance) {
	if inst.timer != nil {
		inst.timer.Stop()
		inst.timer = nil
	}
	UnmountPathProxy(inst.liveID)
	bin := r.cfg.DockerBin
	_ = exec.Command(bin, "rm", "-f", inst.containerName).Run()
	fmt.Fprintf(os.Stderr, "preview: stopped %s\n", inst.containerName)
}

func (r *dockerRunner) resetTTLLocked(key string, inst *dockerInstance, ttl time.Duration) {
	if ttl <= 0 {
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
		fmt.Fprintf(os.Stderr, "preview: idle %s expired, stopping %s (%s)\n", ttl, inst.containerName, key)
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

func dockerDevCommand(pm, script, basePath string) string {
	prefix := ""
	switch pm {
	case "pnpm", "yarn":
		// node images ship corepack; enable the lockfile's package manager.
		prefix = "corepack enable && "
	}
	args := "run " + script
	if pm == "npm" {
		args += " --"
	}
	// --host: Vite defaults to localhost-only (unreachable from the API container).
	// --base: path proxy lives under /__live/{id}/; absolute /@vite/* must match.
	args += fmt.Sprintf(" --host 0.0.0.0 --port %d --strictPort --base %s", dockerPreviewPort, basePath)
	return fmt.Sprintf("%s%s install && %s %s", prefix, pm, pm, args)
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
