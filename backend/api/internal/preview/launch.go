package preview

import (
	"path/filepath"
	"strconv"
	"strings"

	"github.com/Enizri/terra/backend/api/internal/appgraph"
	"github.com/Enizri/terra/backend/api/internal/scan"
)

// launch is what one boot knows about the app it is starting.
type launch struct {
	Port int
	// BasePath is the sub-path the app is served under ("/__live/{id}/"), or
	// "" when it owns its origin.
	BasePath string
	// AllHosts asks the dev server to bind 0.0.0.0. A sibling container is
	// reached from outside itself; a host process is not.
	AllHosts bool
}

// launchSpec is the argv and env one framework understands.
type launchSpec struct {
	flags argFlags
	// env returns framework-specific variables, on top of PORT.
	env func(l launch) []string
	// SupportsBasePath is true when the framework takes its base path on the
	// command line. The rest can only be told in a config file Terra does not
	// write, so they get their own origin instead of a /__live/{id}/ mount.
	SupportsBasePath bool
}

// argFlags names the flags one framework spells. An empty name means the
// framework has no such flag, so nothing is emitted for it: an unknown flag
// is not ignored, it kills the boot.
type argFlags struct {
	before []string // fixed argv that must come first (Flutter's device)
	host   string   // binds every interface
	port   string   // pins the port
	strict bool     // Vite's --strictPort: fail rather than hop to a free port
	base   string   // sets the base path
}

// launchSpecs maps a framework (appgraph.App.Framework) to its launch spec.
// The zero spec — no flags, PORT only — is deliberate for go, python, node and
// anything unrecognised: their runfile templates already carry the port, and
// guessing a flag there is what broke every non-Vite dev server.
var launchSpecs = map[string]launchSpec{
	"vite":      {flags: argFlags{host: "--host", port: "--port", strict: true, base: "--base"}, SupportsBasePath: true},
	"sveltekit": {flags: argFlags{host: "--host", port: "--port"}},
	"astro":     {flags: argFlags{host: "--host", port: "--port"}},
	"nuxt":      {flags: argFlags{host: "--host", port: "--port"}},
	"remix":     {flags: argFlags{host: "--host", port: "--port"}},
	"next":      {flags: argFlags{host: "-H", port: "-p"}},
	"angular":   {flags: argFlags{host: "--host", port: "--port", base: "--base-href"}, SupportsBasePath: true},
	"expo":      {flags: argFlags{port: "--port"}},
	"flutter":   {flags: argFlags{before: []string{"-d", "web-server"}, host: "--web-hostname", port: "--web-port"}},
	// react-scripts takes no flags at all; everything is environment.
	"cra": {env: craEnv, SupportsBasePath: true},
}

// specFor returns the launch spec for a framework name. Unknown frameworks get
// the zero spec, which is flag-free.
func specFor(framework string) launchSpec { return launchSpecs[framework] }

// args returns the flags to append after the dev script.
func (s launchSpec) args(l launch) []string {
	f := s.flags
	var args []string
	args = append(args, f.before...)
	if f.host != "" && l.AllHosts {
		args = append(args, f.host, "0.0.0.0")
	}
	if f.port != "" {
		args = append(args, f.port, strconv.Itoa(l.Port))
	}
	if f.strict {
		args = append(args, "--strictPort")
	}
	if f.base != "" && l.BasePath != "" {
		args = append(args, f.base, l.BasePath)
	}
	return args
}

// environ returns the variables to add to childEnv for this boot. PORT goes to
// everyone: it is the one convention a flag-free server still reads.
func (s launchSpec) environ(l launch) []string {
	env := []string{"PORT=" + strconv.Itoa(l.Port)}
	if s.env != nil {
		env = append(env, s.env(l)...)
	}
	return env
}

func craEnv(l launch) []string {
	var env []string
	if l.AllHosts {
		env = append(env, "HOST=0.0.0.0")
	}
	if l.BasePath != "" {
		env = append(env, "PUBLIC_URL="+l.BasePath)
	}
	return env
}

// frameworkFor names the toolchain that boots appDir, reading the same app
// graph the map does. A checkout it cannot place launches flag-free.
func frameworkFor(root, appDir string) string {
	apps, err := appgraph.For(root, scan.CheckoutCommit(root))
	if err != nil {
		return ""
	}
	want, err := filepath.Rel(root, appDir)
	if err != nil {
		return ""
	}
	want = filepath.ToSlash(want)
	for _, app := range apps {
		if app.Dir == want {
			return app.Framework
		}
	}
	return ""
}

// scriptArgs joins a package script with its launch flags. npm needs `--` to
// forward flags to the script; pnpm and yarn pass them through as they are.
func scriptArgs(pm, script string, flags []string) []string {
	args := []string{"run", script}
	if len(flags) == 0 {
		return args
	}
	if pm == "npm" {
		args = append(args, "--")
	}
	return append(args, flags...)
}

// scriptCommand is scriptArgs as one shell word list, for `bash -lc`.
func scriptCommand(pm, script string, flags []string) string {
	return pm + " " + strings.Join(scriptArgs(pm, script, flags), " ")
}
