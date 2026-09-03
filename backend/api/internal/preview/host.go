package preview

import (
	"fmt"
	"os/exec"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/Enizri/terra/backend/api/internal/appgraph"
	"github.com/Enizri/terra/backend/api/internal/config"
	"github.com/Enizri/terra/backend/api/internal/scan"
)

// hostRunner is today's host-exec preview implementation behind Runner.
type hostRunner struct {
	mu     sync.Mutex
	cfg    *config.Config
	byRepo map[string]*instance
	boots  map[string]*bootWait
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
		limit := previewLimit(r.cfg)
		ttl := time.Duration(0)
		if r.cfg != nil {
			ttl = r.cfg.PreviewTTL
		}

		if inst, ok := r.byRepo[key]; ok {
			url := inst.proxyURL
			r.mu.Unlock()
			if inst.healthy() {
				r.mu.Lock()
				if cur, ok := r.byRepo[key]; ok && cur == inst {
					r.resetTTLLocked(key, inst, ttl)
					r.mu.Unlock()
					return url, nil
				}
				r.mu.Unlock()
				continue
			}
			r.mu.Lock()
			if cur, ok := r.byRepo[key]; ok && cur == inst {
				r.stopInstanceLocked(cur)
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
			r.mu.Unlock()
			return "", fmt.Errorf("preview capacity full (%d apps / %d); stop another preview or raise TERRA_PREVIEW_MAX", used, limit)
		}
		if r.boots == nil {
			r.boots = map[string]*bootWait{}
		}
		wait := &bootWait{done: make(chan struct{})}
		r.boots[key] = wait
		r.mu.Unlock()

		url, err := r.runBoot(key, ttl, wait)
		return url, err
	}
}

// runBoot runs boot and always clears the boots entry, even on panic.
func (r *hostRunner) runBoot(key string, ttl time.Duration, wait *bootWait) (url string, err error) {
	var inst *instance
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("preview boot panicked: %v", rec)
			inst = nil
		}
		r.mu.Lock()
		if err == nil && inst != nil {
			r.byRepo[key] = inst
			r.resetTTLLocked(key, inst, ttl)
		} else {
			if inst != nil {
				r.stopInstanceLocked(inst)
			} else if partial := r.starting[key]; partial != nil {
				r.stopInstanceLocked(partial)
			}
		}
		delete(r.starting, key)
		delete(r.boots, key)
		close(wait.done)
		r.mu.Unlock()
	}()
	url, inst, err = r.boot(key)
	return url, err
}

func (r *hostRunner) trackStarting(key string, inst *instance) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.starting == nil {
		r.starting = map[string]*instance{}
	}
	r.starting[key] = inst
}

func (r *hostRunner) reserveApps(key string, n int) error {
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

// boot does the heavy lifting for one repo. It must not touch r.mu except
// through trackStarting / reserveApps.
func (r *hostRunner) boot(key string) (string, *instance, error) {
	root, err := scan.Checkout(r.cfg.CheckoutDir, key)
	if err != nil {
		return "", nil, err
	}
	apps, err := appgraph.For(root, scan.CheckoutCommit(root))
	if err != nil {
		return r.startViaRunfile(key, root, err)
	}
	order := bootOrder(apps)
	if len(order) == 0 {
		return "", nil, noPreviewable(root, apps)
	}
	if err := r.reserveApps(key, len(order)); err != nil {
		return "", nil, err
	}
	primary, _ := appgraph.Primary(apps)
	inst := &instance{root: root}
	r.trackStarting(key, inst)

	var extraEnv []string
	for _, app := range order {
		port, err := freePort()
		if err != nil {
			inst.stop("")
			return "", nil, err
		}
		spec := specFor(app.Framework)
		liveID := appLiveID(key, app.ID, app.ID == primary.ID)
		opts := launch{Port: port}
		if spec.SupportsBasePath {
			opts.BasePath = "/__live/" + liveID + "/"
		}
		proc, err := startHostApp(r.cfg, key, root, app, opts, extraEnv)
		if err != nil {
			inst.stop("")
			return "", nil, err
		}
		proc.liveID = liveID
		proc.primary = app.ID == primary.ID
		bound, err := waitReady(port, proc.logs, watch(proc.cmd), readyBudget(app), skipPorts(inst.apps)...)
		if err != nil {
			proc.stop("")
			inst.stop("")
			return "", nil, fmt.Errorf("%s never came up: %v\n--- output ---\n%s", app.ID, err, proc.logs.String())
		}
		proc.port = bound
		proc.target = "http://localhost:" + strconv.Itoa(bound)
		authFix := seedDemoAuth(key, proc.target)
		if err := publishApp(r.cfg, key, proc, spec, true, authFix); err != nil {
			proc.stop("")
			inst.stop("")
			return "", nil, err
		}
		inst.apps = append(inst.apps, proc)
		if app.Kind == appgraph.KindAPI && extraEnv == nil {
			extraEnv = apiProxyEnv("http://localhost:" + strconv.Itoa(bound))
		}
	}
	p := inst.primaryApp()
	if p == nil {
		inst.stop("")
		return "", nil, fmt.Errorf("preview boot produced no apps")
	}
	inst.proxyURL = p.publicURL
	return inst.proxyURL, inst, nil
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
			<-ch.done
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

// Lookup returns the checkout root and primary app dir of a running preview.
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
	return inst.root, inst.appDir(), true
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
	inst.stop("")
}

func (r *hostRunner) resetTTLLocked(key string, inst *instance, ttl time.Duration) {
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
		r.stopInstanceLocked(inst)
		delete(r.byRepo, key)
	})
}

func stop(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.Process != nil {
		syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	}
}
