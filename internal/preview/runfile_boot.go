package preview

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Enizri/terra/internal/runfile"
	"github.com/Enizri/terra/internal/scan"
)

// startViaRunfile boots a repo with no frontend from its inferred Runfile —
// a plain Go or Python service gets proxied (with select.js injected) just
// like a dev server would. Runs outside r.mu (see hostRunner.boot).
func (r *hostRunner) startViaRunfile(key, root string, detectErr error) (string, *instance, error) {
	rf, err := runfile.For(root, scan.CheckoutCommit(root))
	if err != nil {
		return "", nil, fmt.Errorf("%v; and no runfile evidence either", detectErr)
	}
	if !rf.HostRunnable() {
		return "", nil, fmt.Errorf("%v; runfile (%s) is not host-runnable without a sandbox", detectErr, rf.Source)
	}
	port, err := freePort()
	if err != nil {
		return "", nil, err
	}
	shell, env := runfileCommand(rf, root, port)

	if install, ienv := runfileInstall(rf, root); install != "" {
		cmd := exec.Command("/bin/sh", "-c", install)
		cmd.Dir = workDir(root, rf)
		cmd.Env = append(childEnv(), ienv...)
		if out, err := cmd.CombinedOutput(); err != nil {
			return "", nil, fmt.Errorf("runfile install (%s): %v: %s", install, err, tail(out))
		}
	}

	cmd := exec.Command("/bin/sh", "-c", shell)
	cmd.Dir = workDir(root, rf)
	cmd.Env = append(childEnv(), env...)
	// Only Node runs get the trace hook; NODE_OPTIONS means nothing to a Go
	// binary or a uvicorn process.
	if rf.Source == "package.json" {
		cmd.Env = append(cmd.Env, traceEnv(key)...)
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	logs := &boundedBuf{}
	cmd.Stdout = logs
	cmd.Stderr = logs
	if err := cmd.Start(); err != nil {
		return "", nil, fmt.Errorf("runfile run (%s): %w", shell, err)
	}
	// Go services may compile first; same budget as startBackend.
	bound, err := waitReady(port, logs, watch(cmd), 5*time.Minute)
	if err != nil {
		stop(cmd)
		return "", nil, fmt.Errorf("runfile service never came up: %v\n--- output ---\n%s", err, logs.String())
	}
	proxyURL, proxyLn, err := serveProxy(key, "http://localhost:"+strconv.Itoa(bound), nil)
	if err != nil {
		stop(cmd)
		return "", nil, err
	}
	inst := &instance{root: root, appDir: root, cmd: cmd, devPort: bound, proxyURL: proxyURL, proxyLn: proxyLn}
	return proxyURL, inst, nil
}

// runfileCommand turns a Runfile's run template into a shell command and env
// for one boot: "{port}" substituted, PORT exported, and Python runs resolved
// through the checkout's private venv.
func runfileCommand(rf *runfile.Runfile, root string, port int) (shell string, env []string) {
	shell = strings.ReplaceAll(rf.Run, "{port}", strconv.Itoa(port))
	env = []string{"PORT=" + strconv.Itoa(port)}
	if rf.Source == "python" {
		env = append(env, venvPath(root))
	}
	return shell, env
}

// runfileInstall returns the install command (venv creation included for
// Python) and its env, or "" when there is nothing to install.
func runfileInstall(rf *runfile.Runfile, root string) (shell string, env []string) {
	if rf.Install == "" {
		return "", nil
	}
	if rf.Source == "python" {
		return "python3 -m venv .terra-venv && " + rf.Install, []string{venvPath(root)}
	}
	return rf.Install, nil
}

// venvPath puts the checkout's venv first so pip/uvicorn/python resolve
// inside it instead of the host environment.
func venvPath(root string) string {
	return "PATH=" + filepath.Join(root, ".terra-venv", "bin") + ":" + os.Getenv("PATH")
}

func workDir(root string, rf *runfile.Runfile) string {
	if rf.Dir == "" {
		return root
	}
	return filepath.Join(root, filepath.FromSlash(rf.Dir))
}
