package preview

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// detect finds a frontend package.json under root (depth ≤ 2).
func detect(root string) (appDir, script, pm string, err error) {
	type candidate struct {
		dir, script  string
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
