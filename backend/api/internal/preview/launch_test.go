package preview

import (
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// Exact argv and env per framework, in the two shapes a boot takes: host mode
// (own loopback origin, localhost binding) and docker mode (base path, every
// interface). A flag that is not in this table is a flag Terra must not emit.
func TestLaunchSpecArgsAndEnv(t *testing.T) {
	host := launch{Port: 4321}
	sibling := launch{Port: 5173, BasePath: "/__live/acme/", AllHosts: true}

	cases := []struct {
		framework    string
		hostArgs     []string
		siblingArgs  []string
		hostEnv      []string
		siblingEnv   []string
		supportsBase bool
	}{
		{
			framework:    "vite",
			hostArgs:     []string{"--port", "4321", "--strictPort"},
			siblingArgs:  []string{"--host", "0.0.0.0", "--port", "5173", "--strictPort", "--base", "/__live/acme/"},
			hostEnv:      []string{"PORT=4321"},
			siblingEnv:   []string{"PORT=5173"},
			supportsBase: true,
		},
		{
			framework:   "next",
			hostArgs:    []string{"-p", "4321"},
			siblingArgs: []string{"-H", "0.0.0.0", "-p", "5173"},
			hostEnv:     []string{"PORT=4321"},
			siblingEnv:  []string{"PORT=5173"},
		},
		{
			framework:    "cra",
			hostArgs:     nil,
			siblingArgs:  nil,
			hostEnv:      []string{"PORT=4321"},
			siblingEnv:   []string{"PORT=5173", "HOST=0.0.0.0", "PUBLIC_URL=/__live/acme/"},
			supportsBase: true,
		},
		{
			framework:    "angular",
			hostArgs:     []string{"--port", "4321"},
			siblingArgs:  []string{"--host", "0.0.0.0", "--port", "5173", "--base-href", "/__live/acme/"},
			hostEnv:      []string{"PORT=4321"},
			siblingEnv:   []string{"PORT=5173"},
			supportsBase: true,
		},
		{
			framework:   "sveltekit",
			hostArgs:    []string{"--port", "4321"},
			siblingArgs: []string{"--host", "0.0.0.0", "--port", "5173"},
			hostEnv:     []string{"PORT=4321"},
			siblingEnv:  []string{"PORT=5173"},
		},
		{
			framework:   "astro",
			hostArgs:    []string{"--port", "4321"},
			siblingArgs: []string{"--host", "0.0.0.0", "--port", "5173"},
			hostEnv:     []string{"PORT=4321"},
			siblingEnv:  []string{"PORT=5173"},
		},
		{
			framework:   "nuxt",
			hostArgs:    []string{"--port", "4321"},
			siblingArgs: []string{"--host", "0.0.0.0", "--port", "5173"},
			hostEnv:     []string{"PORT=4321"},
			siblingEnv:  []string{"PORT=5173"},
		},
		{
			framework:   "remix",
			hostArgs:    []string{"--port", "4321"},
			siblingArgs: []string{"--host", "0.0.0.0", "--port", "5173"},
			hostEnv:     []string{"PORT=4321"},
			siblingEnv:  []string{"PORT=5173"},
		},
		{
			framework:   "expo",
			hostArgs:    []string{"--port", "4321"},
			siblingArgs: []string{"--port", "5173"},
			hostEnv:     []string{"PORT=4321"},
			siblingEnv:  []string{"PORT=5173"},
		},
		{
			framework:   "flutter",
			hostArgs:    []string{"-d", "web-server", "--web-port", "4321"},
			siblingArgs: []string{"-d", "web-server", "--web-hostname", "0.0.0.0", "--web-port", "5173"},
			hostEnv:     []string{"PORT=4321"},
			siblingEnv:  []string{"PORT=5173"},
		},
		// The runfile templates already carry {port}; anything extra is a guess.
		{framework: "go", hostEnv: []string{"PORT=4321"}, siblingEnv: []string{"PORT=5173"}},
		{framework: "django", hostEnv: []string{"PORT=4321"}, siblingEnv: []string{"PORT=5173"}},
		{framework: "fastapi", hostEnv: []string{"PORT=4321"}, siblingEnv: []string{"PORT=5173"}},
		{framework: "flask", hostEnv: []string{"PORT=4321"}, siblingEnv: []string{"PORT=5173"}},
		{framework: "node", hostEnv: []string{"PORT=4321"}, siblingEnv: []string{"PORT=5173"}},
		{framework: "express", hostEnv: []string{"PORT=4321"}, siblingEnv: []string{"PORT=5173"}},
		{framework: "", hostEnv: []string{"PORT=4321"}, siblingEnv: []string{"PORT=5173"}},
	}

	for _, c := range cases {
		spec := specFor(c.framework)
		if got := spec.args(host); !slices.Equal(got, c.hostArgs) {
			t.Errorf("%s host args = %q, want %q", c.framework, got, c.hostArgs)
		}
		if got := spec.args(sibling); !slices.Equal(got, c.siblingArgs) {
			t.Errorf("%s sibling args = %q, want %q", c.framework, got, c.siblingArgs)
		}
		if got := spec.environ(host); !slices.Equal(got, c.hostEnv) {
			t.Errorf("%s host env = %q, want %q", c.framework, got, c.hostEnv)
		}
		if got := spec.environ(sibling); !slices.Equal(got, c.siblingEnv) {
			t.Errorf("%s sibling env = %q, want %q", c.framework, got, c.siblingEnv)
		}
		if spec.SupportsBasePath != c.supportsBase {
			t.Errorf("%s SupportsBasePath = %v, want %v", c.framework, spec.SupportsBasePath, c.supportsBase)
		}
	}
}

// Every framework appgraph can report must be launchable — the zero spec is a
// deliberate choice for some of them, never an oversight.
func TestEveryFrameworkHasALaunchSpec(t *testing.T) {
	flagged := []string{"vite", "next", "cra", "angular", "sveltekit", "astro", "nuxt", "remix", "expo", "flutter"}
	for _, name := range flagged {
		if len(specFor(name).flags.port) == 0 && specFor(name).env == nil {
			t.Errorf("%s: no port flag and no env — it would boot on the wrong port", name)
		}
	}
	flagFree := []string{"node", "electron", "tauri", "go", "django", "fastapi", "flask", "express", "fastify", "nest", "react-native", "swift", "android"}
	for _, name := range flagFree {
		if got := specFor(name).args(launch{Port: 3000, BasePath: "/x/", AllHosts: true}); len(got) != 0 {
			t.Errorf("%s: emits %q, want no flags", name, got)
		}
	}
}

func TestScriptArgsForwardsThroughNPMOnly(t *testing.T) {
	flags := []string{"--port", "5173"}
	if got := scriptArgs("npm", "dev", flags); !slices.Equal(got, []string{"run", "dev", "--", "--port", "5173"}) {
		t.Errorf("npm args = %q", got)
	}
	if got := scriptArgs("pnpm", "dev", flags); !slices.Equal(got, []string{"run", "dev", "--port", "5173"}) {
		t.Errorf("pnpm args = %q", got)
	}
	// No flags, no dangling separator: `npm run start --` is not what CRA wants.
	if got := scriptArgs("npm", "start", nil); !slices.Equal(got, []string{"run", "start"}) {
		t.Errorf("npm args without flags = %q", got)
	}
}

// The memos shape — a Go module at the root with a Vite frontend in web/ —
// must produce the command it produces today, in both modes.
func TestMemosShapedCheckoutKeepsItsCommand(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "go.mod"), "module memos\n")
	writeFile(t, filepath.Join(root, "cmd", "memos", "main.go"), "package main\n")
	writeFile(t, filepath.Join(root, "pnpm-lock.yaml"), "")
	writeFile(t, filepath.Join(root, "web", "package.json"),
		`{"scripts":{"dev":"vite"},"devDependencies":{"vite":"^6","react":"^19"}}`)

	appDir, script, pm, err := detect(root)
	if err != nil {
		t.Fatal(err)
	}
	if got := frameworkFor(root, appDir); got != "vite" {
		t.Fatalf("frontend framework = %q, want vite", got)
	}
	if got := frameworkFor(root, root); got != "go" {
		t.Fatalf("backend framework = %q, want go", got)
	}

	spec := specFor(frameworkFor(root, appDir))
	hostCmd := strings.Join(scriptArgs(pm, script, spec.args(launch{Port: 4321})), " ")
	if hostCmd != "run dev --port 4321 --strictPort" {
		t.Errorf("host argv = %q", hostCmd)
	}
	sibling := launch{Port: dockerPreviewPort, BasePath: "/__live/acme/", AllHosts: true}
	want := "corepack enable && pnpm install && pnpm run dev --host 0.0.0.0 --port 5173 --strictPort --base /__live/acme/"
	if got := dockerDevCommand(pm, script, spec, sibling); got != want {
		t.Errorf("docker command = %q, want %q", got, want)
	}
}

// A Next.js checkout gets Next's flags and no base path: /__live/{id}/ can
// only be set in next.config.js, which Terra does not write.
func TestNextCheckoutGetsNextFlags(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "package.json"),
		`{"scripts":{"dev":"next dev"},"dependencies":{"next":"^15","react":"^19"}}`)

	appDir, script, pm, err := detect(root)
	if err != nil {
		t.Fatal(err)
	}
	spec := specFor(frameworkFor(root, appDir))
	if spec.SupportsBasePath {
		t.Fatal("next must not be mounted under a base path")
	}
	got := dockerDevCommand(pm, script, spec, launch{Port: dockerPreviewPort, AllHosts: true})
	want := "npm install && npm run dev -- -H 0.0.0.0 -p 5173"
	if got != want {
		t.Errorf("docker command = %q, want %q", got, want)
	}
}

// Dropping --port from startBackend is only safe because a server that ignores
// PORT still prints where it landed. This is usememos/memos' real banner.
func TestBackendPortDiscoveredFromBanner(t *testing.T) {
	logs := &boundedBuf{}
	logs.Write([]byte("Server running on port 8081\nAccess your memos at: http://localhost:8081\n"))
	if got := candidatePorts(45999, logs, nil); !slices.Equal(got, []int{45999, 8081}) {
		t.Fatalf("candidatePorts = %v, want [45999 8081]", got)
	}
}
