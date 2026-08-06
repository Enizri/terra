// Package preview runs a checked-out repo's frontend dev server and proxies
// it on a local port, injecting a selection script into every HTML page so
// the Terra theater can iframe the real app and pick components in it.
package preview

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/Enizri/terra/internal/scan"
)

//go:embed select.js
var selectJS []byte

// loadSelectJS prefers the on-disk script when present so inspect-highlight
// edits apply without rebuilding terra (embed remains the fallback).
func loadSelectJS() []byte {
	candidates := []string{
		"internal/preview/select.js",
		filepath.Join("..", "internal", "preview", "select.js"),
	}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates,
			filepath.Join(filepath.Dir(exe), "internal", "preview", "select.js"),
			filepath.Join(filepath.Dir(exe), "..", "internal", "preview", "select.js"),
		)
	}
	for _, p := range candidates {
		b, err := os.ReadFile(p)
		if err == nil && len(b) > 0 {
			return b
		}
	}
	return selectJS
}

type instance struct {
	root     string // checkout root
	appDir   string // frontend package dir (holds package.json)
	cmd      *exec.Cmd
	api      *exec.Cmd // the repo's own backend, if it has one
	devPort  int       // the repo's dev server, behind the proxy
	proxyURL string
}

var (
	// ponytail: one global lock held across install+boot; concurrent
	// previews serialize. Fine for a single local user.
	mu     sync.Mutex
	byRepo = map[string]*instance{}
)

// Start ensures a live preview for repoURL and returns its browser URL.
// Idempotent: a running preview for the same repo is reused.
func Start(repoURL string) (string, error) {
	key, _, err := scan.NormalizeURL(repoURL)
	if err != nil {
		return "", err
	}
	mu.Lock()
	defer mu.Unlock()
	if inst, ok := byRepo[key]; ok {
		// A dev server that died (crash, OOM, manual kill) leaves the proxy
		// listening and every request 502s, so a cached URL is not proof of a
		// live preview — probe it, and rebuild from scratch when it is gone.
		if alive(inst.devPort) {
			return inst.proxyURL, nil
		}
		stop(inst.cmd)
		stop(inst.api)
		delete(byRepo, key)
	}

	root, err := scan.Checkout(key)
	if err != nil {
		return "", err
	}
	appDir, script, pm, err := detect(root)
	if err != nil {
		// No frontend package.json — fall back to the repo's Runfile, which
		// can boot plain Go and Python services (a FastAPI app has no dev
		// script but still has a face once proxied).
		return startViaRunfile(key, root, err)
	}
	if _, err := os.Stat(filepath.Join(appDir, "node_modules")); err != nil {
		install := exec.Command(pm, "install")
		install.Dir = appDir
		if out, err := install.CombinedOutput(); err != nil {
			return "", fmt.Errorf("%s install in %s: %v: %s", pm, appDir, err, tail(out))
		}
	}

	// The backend has to be up *before* the dev server starts: a Vite config
	// reads DEV_PROXY_SERVER once, at process launch.
	var apiCmd *exec.Cmd
	var apiEnv []string
	apiPort := 0
	if pkg, ok := detectGoBackend(root); ok {
		p, c, err := startBackend(root, pkg)
		if err != nil {
			// Hard fail: a frontend whose API calls all 502 is a broken demo.
			return "", err
		}
		apiPort, apiCmd = p, c
		apiEnv = append(apiEnv, "DEV_PROXY_SERVER=http://localhost:"+strconv.Itoa(apiPort))
	}

	devPort, err := freePort()
	if err != nil {
		stop(apiCmd)
		return "", err
	}
	// ponytail: Vite-style port flags plus a PORT env var; stdout parsing
	// below is the only fallback. CRA/Next oddballs are out of scope.
	// npm needs `--` to forward flags; pnpm/yarn pass it through to the script
	// verbatim, which leaves vite bound to whatever its config says.
	args := []string{"run", script}
	if pm == "npm" {
		args = append(args, "--")
	}
	args = append(args, "--port", strconv.Itoa(devPort), "--strictPort")
	cmd := exec.Command(pm, args...)
	cmd.Dir = appDir
	cmd.Env = append(os.Environ(), "PORT="+strconv.Itoa(devPort), "BROWSER=none")
	cmd.Env = append(cmd.Env, apiEnv...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	logs := &boundedBuf{}
	cmd.Stdout = logs
	cmd.Stderr = logs
	if err := cmd.Start(); err != nil {
		stop(apiCmd)
		return "", fmt.Errorf("start dev server (%s run %s): %w", pm, script, err)
	}

	port, err := waitReady(devPort, logs, watch(cmd), 2*time.Minute, apiPort)
	if err != nil {
		stop(cmd)
		stop(apiCmd)
		return "", fmt.Errorf("dev server never came up: %v\n--- output ---\n%s", err, logs.String())
	}

	// Best-effort auto sign-in: demo instances shouldn't greet visitors with a
	// login wall. No-op for repos without a memos-style auth API.
	hasAuth := seedAuth(port)

	proxyURL, err := serveProxy(port, hasAuth)
	if err != nil {
		stop(cmd)
		stop(apiCmd)
		return "", err
	}
	byRepo[key] = &instance{root: root, appDir: appDir, cmd: cmd, api: apiCmd, devPort: port, proxyURL: proxyURL}
	return proxyURL, nil
}

// Lookup returns the checkout root and frontend dir of a running preview.
func Lookup(repoURL string) (root, appDir string, ok bool) {
	key, _, err := scan.NormalizeURL(repoURL)
	if err != nil {
		return "", "", false
	}
	mu.Lock()
	defer mu.Unlock()
	inst, ok := byRepo[key]
	if !ok {
		return "", "", false
	}
	return inst.root, inst.appDir, true
}

// StopAll kills every dev-server process group. Call on shutdown.
func StopAll() {
	mu.Lock()
	defer mu.Unlock()
	for key, inst := range byRepo {
		stop(inst.cmd)
		stop(inst.api)
		delete(byRepo, key)
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

/* ---------- frontend detection ---------- */

// detect finds the most frontend-looking package.json within two directory
// levels of root and returns its dir, dev script name, and package manager.
func detect(root string) (appDir, script, pm string, err error) {
	type candidate struct {
		dir, script string
		score       int
	}
	var best *candidate
	filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if name == "node_modules" || name == ".git" {
				return filepath.SkipDir
			}
			if depth(root, path) > 2 {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Name() != "package.json" {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		var pkg struct {
			Scripts         map[string]string `json:"scripts"`
			Dependencies    map[string]string `json:"dependencies"`
			DevDependencies map[string]string `json:"devDependencies"`
		}
		if json.Unmarshal(data, &pkg) != nil {
			return nil
		}
		s := ""
		if pkg.Scripts["dev"] != "" {
			s = "dev"
		} else if pkg.Scripts["start"] != "" {
			s = "start"
		}
		if s == "" {
			return nil
		}
		score := 0
		if s == "dev" {
			score++
		}
		for _, dep := range []string{"react", "vite"} {
			if pkg.Dependencies[dep] != "" || pkg.DevDependencies[dep] != "" {
				score += 2
			}
		}
		if best == nil || score > best.score {
			best = &candidate{dir: filepath.Dir(path), script: s, score: score}
		}
		return nil
	})
	if best == nil {
		return "", "", "", fmt.Errorf("no package.json with a dev/start script found in %s", root)
	}
	return best.dir, best.script, packageManager(best.dir, root), nil
}

func depth(root, path string) int {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." {
		return 0
	}
	return len(strings.Split(rel, string(filepath.Separator)))
}

func packageManager(dir, root string) string {
	for _, d := range []string{dir, root} {
		if _, err := os.Stat(filepath.Join(d, "pnpm-lock.yaml")); err == nil {
			return "pnpm"
		}
		if _, err := os.Stat(filepath.Join(d, "yarn.lock")); err == nil {
			return "yarn"
		}
	}
	return "npm"
}

/* ---------- backend ---------- */

// detectGoBackend finds a repo-root Go program to run alongside the frontend.
// ponytail: one cmd/*/main.go next to a go.mod is the whole heuristic —
// memos, and most single-binary Go repos, look exactly like that. Repos with
// several commands get no backend rather than a guessed one.
func detectGoBackend(root string) (pkg string, ok bool) {
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err != nil {
		return "", false
	}
	mains, err := filepath.Glob(filepath.Join(root, "cmd", "*", "main.go"))
	if err != nil || len(mains) != 1 {
		return "", false
	}
	return "./cmd/" + filepath.Base(filepath.Dir(mains[0])), true
}

// startBackend runs the repo's Go server on a free port. The data dir is
// persistent and keyed by checkout, so an account created inside the preview
// survives a Terra restart.
func startBackend(root, pkg string) (int, *exec.Cmd, error) {
	port, err := freePort()
	if err != nil {
		return 0, nil, err
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return 0, nil, err
	}
	data := filepath.Join(cache, "terra", "data", filepath.Base(root))

	cmd := exec.Command("go", "run", pkg, "--port", strconv.Itoa(port), "--data", data)
	cmd.Dir = root
	// `go run` execs the compiled binary as a child: only a group kill reaches it.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	// Its own buffer — sharing the frontend's would let candidatePorts hand
	// the dev server the backend's port.
	logs := &boundedBuf{}
	cmd.Stdout = logs
	cmd.Stderr = logs
	if err := cmd.Start(); err != nil {
		return 0, nil, fmt.Errorf("start backend (go run %s): %w", pkg, err)
	}
	// 5 minutes, not 2: a cold `go run` compiles the whole module first.
	if _, err := waitReady(port, logs, watch(cmd), 5*time.Minute); err != nil {
		stop(cmd)
		return 0, nil, fmt.Errorf("backend never came up: %v\n--- output ---\n%s", err, logs.String())
	}
	return port, cmd, nil
}

/* ---------- dev server readiness ---------- */

var portRe = regexp.MustCompile(`(?:localhost|127\.0\.0\.1):(\d{2,5})`)

// watch reaps cmd in the background; the returned channel closes when it
// exits. Exactly one goroutine may call Wait, so this is its only caller.
func watch(cmd *exec.Cmd) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(done)
	}()
	return done
}

// waitReady polls the requested port; if the server picked its own port
// instead, it falls back to whatever port the process printed.
// Ports in `skip` are never probed: the dev server echoes the backend's URL
// on startup (memos prints its DEV_PROXY_SERVER), and a backend that answers
// before vite binds would otherwise win the race and get proxied as the app.
func waitReady(want int, logs *boundedBuf, exited <-chan struct{}, budget time.Duration, skip ...int) (int, error) {
	probe := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(budget)
	for time.Now().Before(deadline) {
		select {
		case <-exited:
			return 0, fmt.Errorf("process exited")
		default:
		}
		for _, p := range candidatePorts(want, logs, skip) {
			// "localhost", not 127.0.0.1: modern Vite/Node may bind ::1 only.
			resp, err := probe.Get("http://localhost:" + strconv.Itoa(p) + "/")
			if err == nil {
				resp.Body.Close()
				return p, nil
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return 0, fmt.Errorf("timed out after %s", budget)
}

func candidatePorts(want int, logs *boundedBuf, skip []int) []int {
	ports := []int{want}
	for _, m := range portRe.FindAllStringSubmatch(logs.String(), -1) {
		p, err := strconv.Atoi(m[1])
		if err != nil || p == want || slices.Contains(skip, p) || slices.Contains(ports, p) {
			continue
		}
		ports = append(ports, p)
	}
	return ports
}

// alive reports whether something still answers HTTP on port.
func alive(port int) bool {
	if port == 0 {
		return false
	}
	c := &http.Client{Timeout: 2 * time.Second}
	resp, err := c.Get("http://localhost:" + strconv.Itoa(port) + "/")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return true
}

func freePort() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port, nil
}

/* ---------- demo auto sign-in (memos-style APIs) ---------- */

const (
	demoUser = "terra"
	demoPass = "terra-demo-2026"
)

func signinDemo(client *http.Client, base string) (*http.Response, error) {
	body := fmt.Sprintf(
		`{"passwordCredentials":{"username":%q,"password":%q}}`, demoUser, demoPass)
	return client.Post(base+"/api/v1/auth/signin", "application/json", strings.NewReader(body))
}

// refreshCookie extracts the refresh cookie from a signin response.
// grpc-gateway can surface it as Grpc-Metadata-Set-Cookie instead of a real
// Set-Cookie header — accept either.
func refreshCookie(resp *http.Response) string {
	for _, header := range []string{"Set-Cookie", "Grpc-Metadata-Set-Cookie"} {
		for _, v := range resp.Header.Values(header) {
			if strings.HasPrefix(v, "memos_refresh=") {
				return strings.SplitN(v, ";", 2)[0]
			}
		}
	}
	return ""
}

// seedAuth makes sure the demo instance has a signed-in-able demo user (plus
// a few public notes when the instance is brand new) and returns true when a
// memos-style auth API answered. Everything is best-effort: on any failure
// the preview simply shows whatever the app shows, as before.
func seedAuth(devPort int) bool {
	base := "http://localhost:" + strconv.Itoa(devPort)
	client := &http.Client{Timeout: 5 * time.Second}

	resp, err := signinDemo(client, base)
	if err != nil {
		return false
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		// First run: create the initial user (memos makes it the admin when the
		// instance is empty, unauthenticated), then sign in for real.
		userBody := fmt.Sprintf(
			`{"username":%q,"password":%q,"displayName":"Terra"}`, demoUser, demoPass)
		cr, err := client.Post(base+"/api/v1/users", "application/json", strings.NewReader(userBody))
		if err != nil {
			return false
		}
		created := cr.StatusCode == http.StatusOK
		cr.Body.Close()
		if resp, err = signinDemo(client, base); err != nil {
			return false
		}
		if created {
			seedMemos(client, base, resp)
		}
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK && refreshCookie(resp) != ""
}

// seedMemos drops a few public notes into a freshly created instance so the
// first screen a visitor sees has content, not an empty timeline.
func seedMemos(client *http.Client, base string, signinResp *http.Response) {
	var out struct {
		AccessToken string `json:"accessToken"`
	}
	raw, err := io.ReadAll(signinResp.Body)
	if err != nil || json.Unmarshal(raw, &out) != nil || out.AccessToken == "" {
		signinResp.Body = io.NopCloser(bytes.NewReader(raw))
		return
	}
	signinResp.Body = io.NopCloser(bytes.NewReader(raw))
	notes := []string{
		"**Welcome!** This is a live instance of `usememos/memos`, running inside Terra's map.",
		"Everything here is real — the screens come from `web/src`, requests go through `internal/api`, and notes land in `store/memo.go`.",
		"Try it: write a note, then ask Terra which file just saved it.",
	}
	for _, n := range notes {
		body, _ := json.Marshal(map[string]string{"content": n, "visibility": "PUBLIC"})
		req, _ := http.NewRequest("POST", base+"/api/v1/memos", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+out.AccessToken)
		if r, err := client.Do(req); err == nil {
			r.Body.Close()
		}
	}
}

/* ---------- injecting reverse proxy ---------- */

const injectTag = `<script src="/__terra/select.js"></script>`

// serveProxy proxies the dev server root-of-origin on its own port so the
// app's absolute asset paths (/src/main.tsx, /@vite/client) keep working,
// and injects the selection script into HTML responses.
func serveProxy(devPort int, hasAuth bool) (string, error) {
	base := "http://localhost:" + strconv.Itoa(devPort)
	target, _ := url.Parse(base)
	authClient := &http.Client{Timeout: 5 * time.Second}
	rp := httputil.NewSingleHostReverseProxy(target)
	director := rp.Director
	rp.Director = func(r *http.Request) {
		director(r)
		r.Host = target.Host
		// No compressed bodies, so injection always sees plain HTML.
		r.Header.Del("Accept-Encoding")
		// Auto sign-in: the app's silent token refresh normally needs a cookie
		// the visitor doesn't have. Mint a fresh session for each such call —
		// tokens rotate on every refresh, so a cookie captured once at boot
		// would die after its first use.
		if hasAuth &&
			(strings.Contains(r.URL.Path, "auth/refresh") ||
				strings.Contains(r.URL.Path, "AuthService/RefreshToken")) &&
			!strings.Contains(r.Header.Get("Cookie"), "memos_refresh=") {
			if resp, err := signinDemo(authClient, base); err == nil {
				if c := refreshCookie(resp); c != "" {
					if prev := r.Header.Get("Cookie"); prev != "" {
						r.Header.Set("Cookie", prev+"; "+c)
					} else {
						r.Header.Set("Cookie", c)
					}
				}
				resp.Body.Close()
			}
		}
	}
	rp.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Del("X-Frame-Options")
		resp.Header.Del("Content-Security-Policy")
		if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html") {
			return nil
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return err
		}
		if i := bytes.Index(body, []byte("</head>")); i >= 0 {
			body = append(body[:i:i], append([]byte(injectTag), body[i:]...)...)
		} else {
			body = append(body, injectTag...)
		}
		resp.Body = io.NopCloser(bytes.NewReader(body))
		resp.ContentLength = int64(len(body))
		resp.Header.Set("Content-Length", strconv.Itoa(len(body)))
		return nil
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/__terra/select.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(loadSelectJS())
	})
	mux.Handle("/", rp)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	go http.Serve(ln, mux)
	return "http://" + ln.Addr().String() + "/", nil
}

/* ---------- bounded output buffer ---------- */

// boundedBuf keeps the last ~64KB of dev-server output for error messages
// and port discovery.
type boundedBuf struct {
	mu  sync.Mutex
	buf []byte
}

func (b *boundedBuf) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.buf = append(b.buf, p...)
	if len(b.buf) > 64<<10 {
		b.buf = b.buf[len(b.buf)-64<<10:]
	}
	return len(p), nil
}

func (b *boundedBuf) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return string(b.buf)
}

func tail(out []byte) string {
	s := strings.TrimSpace(string(out))
	if len(s) > 2000 {
		s = s[len(s)-2000:]
	}
	return s
}
