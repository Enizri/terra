package preview

import (
	"fmt"

	"github.com/Enizri/terra/internal/config"
)

// Runner boots and looks up live preview instances for a repository.
// Phase 1a: host-exec. Phase 1b: Docker sibling containers.
type Runner interface {
	Start(repoURL string) (proxyURL string, err error)
	Lookup(repoURL string) (root, appDir string, ok bool)
	StopAll()
}

// Default returns the Runner selected by c.PreviewMode.
// Empty or "host" → host-exec (make dev). "docker" → sibling containers.
func Default(c *config.Config) Runner {
	switch c.PreviewMode {
	case "", "host":
		return Host(c)
	case "docker":
		return Docker(c)
	default:
		return invalidRunner{mode: c.PreviewMode}
	}
}

// host is the process-wide host-exec runner (shared preview state).
var host = &hostRunner{byRepo: map[string]*instance{}}

// Host returns the process-local host-exec preview runner, configured with c.
func Host(c *config.Config) Runner {
	host.mu.Lock()
	host.cfg = c
	host.mu.Unlock()
	return host
}

// StopAll kills every preview from both runners. Call on shutdown.
func StopAll() {
	host.StopAll()
	dockerDefault.StopAll()
}

type invalidRunner struct{ mode string }

func (r invalidRunner) Start(string) (string, error) {
	return "", fmt.Errorf("unknown TERRA_PREVIEW_MODE %q (want host or docker)", r.mode)
}

func (r invalidRunner) Lookup(string) (string, string, bool) { return "", "", false }

func (r invalidRunner) StopAll() {}
