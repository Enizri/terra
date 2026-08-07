// Package preview boots a repo's frontend (and optional backend) behind a local proxy.
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

//go:embed hook.js
var hookJS []byte

// loadSelectJS prefers on-disk select.js; falls back to the embed.
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
	for _, cand := range candidates {
		b, err := os.ReadFile(cand)
		if err == nil && len(b) > 0 {
			return b
		}
	}
	return selectJS
}

// hookJSPath returns an absolute path to hook.js for NODE_OPTIONS --require.
func hookJSPath() (string, error) {
	candidates := []string{
		"internal/preview/hook.js",
		filepath.Join("..", "internal", "preview", "hook.js"),
	}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates,
			filepath.Join(filepath.Dir(exe), "internal", "preview", "hook.js"),
			filepath.Join(filepath.Dir(exe), "..", "internal", "preview", "hook.js"),
		)
	}
	for _, cand := range candidates {
		if b, err := os.ReadFile(cand); err == nil && len(b) > 0 {
			return filepath.Abs(cand)
		}
	}
	hookPath := filepath.Join(os.TempDir(), "terra-hook.js")
	if err := os.WriteFile(hookPath, hookJS, 0o644); err != nil {
		return "", err
	}
	return hookPath, nil
}

// mergeNodeOptions appends the hook --require to NODE_OPTIONS.
func mergeNodeOptions(existing, hookPath string) string {
	if strings.Contains(hookPath, " ") {
		hookPath = `"` + hookPath + `"`
	}
	opt := "--require " + hookPath
	if existing == "" {
		return opt
	}
	return existing + " " + opt
}

// terraPort is where the preview reports spans (from TERRA_ADDR, default 8080).
func terraPort() string {
	addr := os.Getenv("TERRA_ADDR")
	if addr == "" {
		return "8080"
	}
	if i := strings.LastIndex(addr, ":"); i >= 0 {
		return addr[i+1:]
	}
	return addr
}

// traceEnv returns env vars that preload hook.js for in-process spans.
func traceEnv(repoKey string) []string {
	hook, err := hookJSPath()
	if err != nil {
		return nil
	}
	env := []string{
		"NODE_OPTIONS=" + mergeNodeOptions(os.Getenv("NODE_OPTIONS"), hook),
		"TERRA_TRACE_URL=http://localhost:" + terraPort() + "/traces/ingest",
		"TERRA_TRACE_REPO=" + repoKey,
	}
	if tok := strings.TrimSpace(os.Getenv("TERRA_TOKEN")); tok != "" {
		env = append(env, "TERRA_TRACE_TOKEN="+tok)
	}
	return env
}

// dockerTraceVars are hook ingest settings for a sibling container
// (NODE_OPTIONS is set separately to the in-container hook path).
func dockerTraceVars(repoKey string) []string {
	host := strings.TrimSpace(os.Getenv("TERRA_TRACE_HOST"))
	if host == "" {
		host = "host.docker.internal"
	}
	env := []string{
		"TERRA_TRACE_URL=http://" + host + ":" + terraPort() + "/traces/ingest",
		"TERRA_TRACE_REPO=" + repoKey,
	}
	if tok := strings.TrimSpace(os.Getenv("TERRA_TOKEN")); tok != "" {
		env = append(env, "TERRA_TRACE_TOKEN="+tok)
	}
	return env
}

type instance struct {
	root     string // checkout root
	appDir   string // frontend package dir (holds package.json)
	cmd      *exec.Cmd
	api      *exec.Cmd // the repo's own backend, if it has one
	devPort  int       // the repo's dev server, behind the proxy
	proxyURL string
}

// hostRunner is today's host-exec preview implementation behind Runner.
type hostRunner struct {
	mu     sync.Mutex
	byRepo map[string]*instance
}

// Start returns a live preview URL for repoURL, reusing a healthy instance.
func (r *hostRunner) Start(repoURL string) (string, error) {
	key, _, err := scan.NormalizeURL(repoURL)
	if err != nil {
		return "", err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if inst, ok := r.byRepo[key]; ok {
		if alive(inst.devPort) {
			return inst.proxyURL, nil
		}
		stop(inst.cmd)
		stop(inst.api)
		delete(r.byRepo, key)
	}

	root, err := scan.Checkout(key)
	if err != nil {
		return "", err
	}
	appDir, script, pm, err := detect(root)
	if err != nil {
		return r.startViaRunfile(key, root, err)
	}
	if _, err := os.Stat(filepath.Join(appDir, "node_modules")); err != nil {
		install := exec.Command(pm, "install")
		install.Dir = appDir
		if out, err := install.CombinedOutput(); err != nil {
			return "", fmt.Errorf("%s install in %s: %v: %s", pm, appDir, err, tail(out))
		}
	}

	// Backend before frontend: Vite reads DEV_PROXY_SERVER at process start.
	var apiCmd *exec.Cmd
	var apiEnv []string
	apiPort := 0
	if pkg, ok := detectGoBackend(root); ok {
		port, backend, err := startBackend(root, pkg)
		if err != nil {
			return "", err
		}
		apiPort, apiCmd = port, backend
		apiEnv = append(apiEnv, "DEV_PROXY_SERVER=http://localhost:"+strconv.Itoa(apiPort))
	}

	devPort, err := freePort()
	if err != nil {
		stop(apiCmd)
		return "", err
	}
	// npm needs `--` to forward port flags; pnpm/yarn do not.
	args := []string{"run", script}
	if pm == "npm" {
		args = append(args, "--")
	}
	args = append(args, "--port", strconv.Itoa(devPort), "--strictPort")
	cmd := exec.Command(pm, args...)
	cmd.Dir = appDir
	cmd.Env = append(os.Environ(), "PORT="+strconv.Itoa(devPort), "BROWSER=none")
	cmd.Env = append(cmd.Env, apiEnv...)
	cmd.Env = append(cmd.Env, traceEnv(key)...)
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

	targetBase := "http://localhost:" + strconv.Itoa(port)
	hasAuth := seedAuth(targetBase)

	proxyURL, err := serveProxy(key, targetBase, hasAuth)
	if err != nil {
		stop(cmd)
		stop(apiCmd)
		return "", err
	}
	r.byRepo[key] = &instance{root: root, appDir: appDir, cmd: cmd, api: apiCmd, devPort: port, proxyURL: proxyURL}
	return proxyURL, nil
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

// StopAll kills every dev-server process group. Call on shutdown.
func (r *hostRunner) StopAll() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for key, inst := range r.byRepo {
		stop(inst.cmd)
		stop(inst.api)
		delete(r.byRepo, key)
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

// detect finds a frontend package.json under root (depth ≤ 2).
func detect(root string) (appDir, script, pm string, err error) {
	type candidate struct {
		dir, script string
		score, depth int
	}
	var best *candidate
	filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if name == "node_modules" || name == ".git" || name == "examples" {
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
		script := ""
		if pkg.Scripts["dev"] != "" {
			script = "dev"
		} else if pkg.Scripts["start"] != "" {
			script = "start"
		}
		if script == "" {
			return nil
		}
		score := 0
		if script == "dev" {
			score++
		}
		for _, dep := range []string{"react", "vite"} {
			if pkg.Dependencies[dep] != "" || pkg.DevDependencies[dep] != "" {
				score += 2
			}
		}
		// Prefer Vite/React apps; on a tie, prefer the shallower package.json
		// so monorepo examples/ don't beat web/ or the repo root.
		depDepth := depth(root, filepath.Dir(path))
		better := best == nil || score > best.score || (score == best.score && depDepth < best.depth)
		if better {
			best = &candidate{dir: filepath.Dir(path), script: script, score: score, depth: depDepth}
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
	for _, base := range []string{dir, root} {
		if _, err := os.Stat(filepath.Join(base, "pnpm-lock.yaml")); err == nil {
			return "pnpm"
		}
		if _, err := os.Stat(filepath.Join(base, "yarn.lock")); err == nil {
			return "yarn"
		}
	}
	return "npm"
}

/* ---------- backend ---------- */

// detectGoBackend returns "./cmd/<name>" when exactly one cmd/*/main.go exists.
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

// startBackend runs the repo Go server on a free port with a persistent data dir.
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
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	logs := &boundedBuf{}
	cmd.Stdout = logs
	cmd.Stderr = logs
	if err := cmd.Start(); err != nil {
		return 0, nil, fmt.Errorf("start backend (go run %s): %w", pkg, err)
	}
	if _, err := waitReady(port, logs, watch(cmd), 5*time.Minute); err != nil {
		stop(cmd)
		return 0, nil, fmt.Errorf("backend never came up: %v\n--- output ---\n%s", err, logs.String())
	}
	return port, cmd, nil
}

/* ---------- dev server readiness ---------- */

var portRe = regexp.MustCompile(`(?:localhost|127\.0\.0\.1):(\d{2,5})`)

// watch reaps cmd; the channel closes when it exits. Sole Wait caller.
func watch(cmd *exec.Cmd) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(done)
	}()
	return done
}

// waitReady polls want, then ports printed in logs. skip ports are never probed.
func waitReady(want int, logs *boundedBuf, exited <-chan struct{}, budget time.Duration, skip ...int) (int, error) {
	probe := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(budget)
	for time.Now().Before(deadline) {
		select {
		case <-exited:
			return 0, fmt.Errorf("process exited")
		default:
		}
		for _, port := range candidatePorts(want, logs, skip) {
			resp, err := probe.Get("http://localhost:" + strconv.Itoa(port) + "/")
			if err == nil {
				resp.Body.Close()
				return port, nil
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return 0, fmt.Errorf("timed out after %s", budget)
}

func candidatePorts(want int, logs *boundedBuf, skip []int) []int {
	ports := []int{want}
	for _, match := range portRe.FindAllStringSubmatch(logs.String(), -1) {
		port, err := strconv.Atoi(match[1])
		if err != nil || port == want || slices.Contains(skip, port) || slices.Contains(ports, port) {
			continue
		}
		ports = append(ports, port)
	}
	return ports
}

// alive reports whether port answers HTTP.
func alive(port int) bool {
	if port == 0 {
		return false
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://localhost:" + strconv.Itoa(port) + "/")
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

// refreshCookie reads memos_refresh from Set-Cookie or Grpc-Metadata-Set-Cookie.
func refreshCookie(resp *http.Response) string {
	for _, header := range []string{"Set-Cookie", "Grpc-Metadata-Set-Cookie"} {
		for _, value := range resp.Header.Values(header) {
			if strings.HasPrefix(value, "memos_refresh=") {
				return strings.SplitN(value, ";", 2)[0]
			}
		}
	}
	return ""
}

// seedAuth creates a demo user if needed and returns whether auth is available.
func seedAuth(baseURL string) bool {
	base := strings.TrimRight(baseURL, "/")
	client := &http.Client{Timeout: 5 * time.Second}

	resp, err := signinDemo(client, base)
	if err != nil {
		return false
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
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

// seedMemos posts a few public notes into a new demo instance.
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
	for _, note := range notes {
		body, _ := json.Marshal(map[string]string{"content": note, "visibility": "PUBLIC"})
		req, _ := http.NewRequest("POST", base+"/api/v1/memos", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+out.AccessToken)
		if resp, err := client.Do(req); err == nil {
			resp.Body.Close()
		}
	}
}

/* ---------- injecting reverse proxy ---------- */

// serveProxy reverse-proxies a localhost/dev target on an ephemeral loopback port.
func serveProxy(repoKey, targetBase string, hasAuth bool) (string, error) {
	handler, err := newInjectProxy(repoKey, targetBase, hasAuth, "")
	if err != nil {
		return "", err
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	go http.Serve(ln, handler)
	return "http://" + ln.Addr().String() + "/", nil
}

// newInjectProxy reverse-proxies targetBase, injects select.js, and emits spans.
// publicPrefix is the browser-visible path prefix for the script tag
// (e.g. "/__live/id"); the handler itself still serves "/__terra/select.js"
// after the live hub strips the prefix.
func newInjectProxy(repoKey, targetBase string, hasAuth bool, publicPrefix string) (http.Handler, error) {
	base := strings.TrimRight(targetBase, "/")
	target, err := url.Parse(base)
	if err != nil || target.Scheme == "" || target.Host == "" {
		return nil, fmt.Errorf("invalid preview target %q", targetBase)
	}
	inject := `<script src="` + publicPrefix + `/__terra/select.js"></script>`
	authClient := &http.Client{Timeout: 5 * time.Second}
	rp := httputil.NewSingleHostReverseProxy(target)
	director := rp.Director
	rp.Director = func(r *http.Request) {
		director(r)
		// Vite 6+ rejects unknown Host values (container DNS names). localhost
		// is always allowed; the URL still targets the sibling container.
		r.Host = "localhost"
		r.Header.Del("Accept-Encoding")
		// Mint a fresh refresh cookie per auth refresh (tokens rotate).
		if hasAuth &&
			(strings.Contains(r.URL.Path, "auth/refresh") ||
				strings.Contains(r.URL.Path, "AuthService/RefreshToken")) &&
			!strings.Contains(r.Header.Get("Cookie"), "memos_refresh=") {
			if resp, err := signinDemo(authClient, base); err == nil {
				if cookie := refreshCookie(resp); cookie != "" {
					if prev := r.Header.Get("Cookie"); prev != "" {
						r.Header.Set("Cookie", prev+"; "+cookie)
					} else {
						r.Header.Set("Cookie", cookie)
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
		tag := []byte(inject)
		if i := bytes.Index(body, []byte("</head>")); i >= 0 {
			body = append(body[:i:i], append(tag, body[i:]...)...)
		} else {
			body = append(body, tag...)
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
	return traceMiddleware(repoKey, mux), nil
}

/* ---------- bounded output buffer ---------- */

// boundedBuf keeps the last ~64KB of process output.
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
	text := strings.TrimSpace(string(out))
	if len(text) > 2000 {
		text = text[len(text)-2000:]
	}
	return text
}
