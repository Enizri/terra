package preview

import (
	"fmt"
	"os"
	"strings"
)

// Runner boots and looks up live preview instances for a repository.
// Phase 1a: host-exec. Phase 1b: Docker sibling containers.
type Runner interface {
	Start(repoURL string) (proxyURL string, err error)
	Lookup(repoURL string) (root, appDir string, ok bool)
	StopAll()
}

// Default returns the Runner selected by TERRA_PREVIEW_MODE.
// Empty or "host" → host-exec (make dev). "docker" → sibling containers.
func Default() Runner {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("TERRA_PREVIEW_MODE")))
	switch mode {
	case "", "host":
		return Host()
	case "docker":
		return Docker()
	default:
		return invalidRunner{mode: mode}
	}
}

// host is the process-wide host-exec runner (shared preview state).
var host = &hostRunner{byRepo: map[string]*instance{}}

// Host returns the process-local host-exec preview runner.
func Host() Runner { return host }

// Start is a thin wrapper around Default().Start.
func Start(repoURL string) (string, error) { return Default().Start(repoURL) }

// Lookup is a thin wrapper around Default().Lookup.
func Lookup(repoURL string) (root, appDir string, ok bool) {
	return Default().Lookup(repoURL)
}

// StopAll is a thin wrapper around Default().StopAll.
func StopAll() { Default().StopAll() }

type invalidRunner struct{ mode string }

func (r invalidRunner) Start(string) (string, error) {
	return "", fmt.Errorf("unknown TERRA_PREVIEW_MODE %q (want host or docker)", r.mode)
}

func (r invalidRunner) Lookup(string) (string, string, bool) { return "", "", false }

func (r invalidRunner) StopAll() {}
