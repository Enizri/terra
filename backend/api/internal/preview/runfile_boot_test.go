package preview

import (
	"strings"
	"testing"

	"github.com/Enizri/terra/backend/api/internal/runfile"
)

func TestRunfileCommandSubstitutesPort(t *testing.T) {
	rf := &runfile.Runfile{Source: "python", Run: "uvicorn main:app --port {port}"}
	shell, env := runfileCommand(rf, "/tmp/x", 4321)
	if shell != "uvicorn main:app --port 4321" {
		t.Errorf("shell = %q", shell)
	}
	if env[0] != "PORT=4321" {
		t.Errorf("env = %v, want PORT exported", env)
	}
	if len(env) != 2 || !strings.Contains(env[1], "/tmp/x/.terra-venv/bin") {
		t.Errorf("env = %v, want the checkout venv on PATH for python", env)
	}
}

func TestRunfileCommandGoNeedsNoVenv(t *testing.T) {
	rf := &runfile.Runfile{Source: "go.mod", Run: "go run ./cmd/server"}
	shell, env := runfileCommand(rf, "/tmp/x", 4321)
	if shell != "go run ./cmd/server" || len(env) != 1 {
		t.Errorf("shell = %q, env = %v", shell, env)
	}
}

func TestRunfileInstallWrapsPythonInVenv(t *testing.T) {
	rf := &runfile.Runfile{Source: "python", Install: "pip install -r requirements.txt"}
	shell, env := runfileInstall(rf, "/tmp/x")
	if !strings.HasPrefix(shell, "python3 -m venv .terra-venv && ") {
		t.Errorf("shell = %q, want venv creation first", shell)
	}
	if len(env) != 1 || !strings.Contains(env[0], ".terra-venv/bin") {
		t.Errorf("env = %v", env)
	}

	if shell, env := runfileInstall(&runfile.Runfile{Source: "go.mod"}, "/tmp/x"); shell != "" || env != nil {
		t.Errorf("no install step must stay empty, got %q %v", shell, env)
	}
}

func TestWorkDir(t *testing.T) {
	if got := workDir("/r", &runfile.Runfile{}); got != "/r" {
		t.Errorf("got %q", got)
	}
	if got := workDir("/r", &runfile.Runfile{Dir: "svc/api"}); got != "/r/svc/api" {
		t.Errorf("got %q", got)
	}
}
