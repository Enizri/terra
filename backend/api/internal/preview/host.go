package preview

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/Enizri/terra/backend/api/internal/config"
	"github.com/Enizri/terra/backend/api/internal/scan"
)

type instance struct {
	root     string // checkout root
	appDir   string // frontend package dir (holds package.json)
	cmd      *exec.Cmd
	api      *exec.Cmd // the repo's own backend, if it has one
	devPort  int       // the repo's dev server, behind the proxy
	proxyURL string
	proxyLn  net.Listener // closed on stop, or each restart leaks a listener
}

// hostRunner is today's host-exec preview implementation behind Runner.
type hostRunner struct {
	mu     sync.Mutex
	cfg    *config.Config
	byRepo map[string]*instance
	boots  map[string]chan struct{} // in-flight boots; closed when done
	// starting tracks processes owned by an in-flight boot so StopAll can
	// kill them on Ctrl-C before they land in byRepo.
	starting map[string]*instance
}

// Start returns a live preview URL for repoURL, reusing a healthy instance.
// Boots run outside the mutex: holding it across npm install + ready-waits
// (minutes) would block Lookup — and with it every /files request — and
// serialize unrelated repos behind one slow boot.
func (r *hostRunner) Start(repoURL string) (string, error) {
	key, _, err := scan.NormalizeURL(repoURL)
	if err != nil {
		return "", err
	}
	for {
		r.mu.Lock()
		if inst, ok := r.byRepo[key]; ok {
			port, url := inst.devPort, inst.proxyURL
			r.mu.Unlock()
			if alive(port) {
				return url, nil
			}
			r.mu.Lock()
			if cur, ok := r.byRepo[key]; ok && cur == inst {
				r.stopInstanceLocked(cur)
				delete(r.byRepo, key)
			}
		}
		if ch, ok := r.boots[key]; ok {
			// Someone else is booting this repo; wait and re-check.
			r.mu.Unlock()
			<-ch
			continue
		}
		if r.boots == nil {
			r.boots = map[string]chan struct{}{}
		}
		ch := make(chan struct{})
		r.boots[key] = ch
		r.mu.Unlock()

		url, err := r.runBoot(key, ch)
		return url, err
	}
}

// runBoot runs boot and always clears the boots entry, even on panic.
func (r *hostRunner) runBoot(key string, ch chan struct{}) (url string, err error) {
	var inst *instance
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("preview boot panicked: %v", rec)
			inst = nil
		}
		r.mu.Lock()
		if err == nil && inst != nil {
			r.byRepo[key] = inst
		} else {
			if inst != nil {
				r.stopInstanceLocked(inst)
			} else if partial := r.starting[key]; partial != nil {
				r.stopInstanceLocked(partial)
			}
		}
		delete(r.starting, key)
		delete(r.boots, key)
		close(ch)
		r.mu.Unlock()
	}()
	url, inst, err = r.boot(key)
	return url, err
}

// trackStarting publishes an in-flight instance so StopAll can reach it.
func (r *hostRunner) trackStarting(key string, inst *instance) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.starting == nil {
		r.starting = map[string]*instance{}
	}
	r.starting[key] = inst
}

// boot does the heavy lifting for one repo. It must not touch r.mu.
func (r *hostRunner) boot(key string) (string, *instance, error) {
	root, err := scan.Checkout(r.cfg.CheckoutDir, key)
	if err != nil {
		return "", nil, err
	}
	appDir, script, pm, err := detect(root)
	if err != nil {
		return r.startViaRunfile(key, root, err)
	}
	if _, err := os.Stat(filepath.Join(appDir, "node_modules")); err != nil {
		install := exec.Command(pm, "install")
		install.Dir = appDir
		install.Env = childEnv()
		if out, err := install.CombinedOutput(); err != nil {
			return "", nil, fmt.Errorf("%s install in %s: %v: %s", pm, appDir, err, tail(out))
		}
	}

	// Backend before frontend: Vite reads DEV_PROXY_SERVER at process start.
	var apiCmd *exec.Cmd
	var apiEnv []string
	apiPort := 0
	if pkg, ok := detectGoBackend(root); ok {
		port, backend, err := startBackend(root, pkg)
		if err != nil {
			return "", nil, err
		}
		apiPort, apiCmd = port, backend
		apiEnv = append(apiEnv, "DEV_PROXY_SERVER=http://localhost:"+strconv.Itoa(apiPort))
	}

	devPort, err := freePort()
	if err != nil {
		stop(apiCmd)
		return "", nil, err
	}
	// Host mode gives the app its own loopback proxy origin, so no base path
	// is needed and localhost-only binding is fine.
	spec := specFor(frameworkFor(root, appDir))
	opts := launch{Port: devPort}
	cmd := exec.Command(pm, scriptArgs(pm, script, spec.args(opts))...)
	cmd.Dir = appDir
	cmd.Env = append(childEnv(), spec.environ(opts)...)
	cmd.Env = append(cmd.Env, "BROWSER=none")
	cmd.Env = append(cmd.Env, apiEnv...)
	cmd.Env = append(cmd.Env, traceEnv(r.cfg, key)...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	logs := &boundedBuf{}
	cmd.Stdout = logs
	cmd.Stderr = logs
	if err := cmd.Start(); err != nil {
		stop(apiCmd)
		return "", nil, fmt.Errorf("start dev server (%s run %s): %w", pm, script, err)
	}
	inst := &instance{root: root, appDir: appDir, cmd: cmd, api: apiCmd, devPort: devPort}
	r.trackStarting(key, inst)

	port, err := waitReady(devPort, logs, watch(cmd), 2*time.Minute, apiPort)
	if err != nil {
		stop(cmd)
		stop(apiCmd)
		return "", nil, fmt.Errorf("dev server never came up: %v\n--- output ---\n%s", err, logs.String())
	}

	targetBase := "http://localhost:" + strconv.Itoa(port)
	authFix := seedDemoAuth(key, targetBase)

	proxyURL, proxyLn, err := serveProxy(key, targetBase, authFix)
	if err != nil {
		stop(cmd)
		stop(apiCmd)
		return "", nil, err
	}
	inst.devPort = port
	inst.proxyURL = proxyURL
	inst.proxyLn = proxyLn
	return proxyURL, inst, nil
}

// Restart stops a live preview for repoURL and boots it again. A miss is a
// Start: there is nothing to kill. Does not git commit checkout writes.
func (r *hostRunner) Restart(repoURL string) error {
	key, _, err := scan.NormalizeURL(repoURL)
	if err != nil {
		return err
	}
	for {
		r.mu.Lock()
		if ch, ok := r.boots[key]; ok {
			r.mu.Unlock()
			<-ch
			continue
		}
		if inst, ok := r.byRepo[key]; ok {
			r.stopInstanceLocked(inst)
			delete(r.byRepo, key)
		}
		r.mu.Unlock()
		break
	}
	_, err = r.Start(repoURL)
	return err
}

// Lookup returns the checkout root and frontend dir of a running preview.
func (r *hostRunner) Lookup(repoURL string) (root, appDir string, ok bool) {
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

// StopAll kills every dev-server process group, including in-flight boots.
// Call on shutdown.
func (r *hostRunner) StopAll() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for key, inst := range r.starting {
		r.stopInstanceLocked(inst)
		delete(r.starting, key)
	}
	for key, inst := range r.byRepo {
		r.stopInstanceLocked(inst)
		delete(r.byRepo, key)
	}
}

func (r *hostRunner) stopInstanceLocked(inst *instance) {
	stop(inst.cmd)
	stop(inst.api)
	if inst.proxyLn != nil {
		inst.proxyLn.Close()
		inst.proxyLn = nil
	}
}

func stop(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.Process != nil {
		syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	}
}
