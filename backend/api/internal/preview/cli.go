package preview

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const cliBudget = 30 * time.Second
const cliOutputCap = 64 << 10

var cliDenied = ";|&`$<>(){}!\n\\"

// ParseCLIArgs splits a typed line into argv. Metacharacters are refused so
// this never becomes a shell.
func ParseCLIArgs(line string) ([]string, error) {
	s := strings.TrimSpace(line)
	if s == "" {
		return nil, nil
	}
	if strings.ContainsAny(s, cliDenied) {
		return nil, fmt.Errorf("only arguments to the CLI are allowed, not a shell")
	}
	return strings.Fields(s), nil
}

// CLICommand is the argv Terra prefixes before user args (--help, then typed).
func CLICommand(root string) (argv []string, ok bool) {
	if argv, ok = nodeBin(root); ok {
		return argv, true
	}
	if argv, ok = goCLI(root); ok {
		return argv, true
	}
	if argv, ok = pythonCLI(root); ok {
		return argv, true
	}
	return nil, false
}

func nodeBin(root string) ([]string, bool) {
	data, err := os.ReadFile(filepath.Join(root, "package.json"))
	if err != nil {
		return nil, false
	}
	var pkg struct {
		Bin json.RawMessage `json:"bin"`
	}
	if json.Unmarshal(data, &pkg) != nil || len(bytes.TrimSpace(pkg.Bin)) == 0 {
		return nil, false
	}
	var asString string
	if json.Unmarshal(pkg.Bin, &asString) == nil && asString != "" {
		return []string{"node", filepath.FromSlash(asString)}, true
	}
	var asMap map[string]string
	if json.Unmarshal(pkg.Bin, &asMap) != nil {
		return nil, false
	}
	for _, path := range asMap {
		if path != "" {
			return []string{"node", filepath.FromSlash(path)}, true
		}
	}
	return nil, false
}

func goCLI(root string) ([]string, bool) {
	if !fileExists(root, "go.mod") {
		return nil, false
	}
	mains, _ := filepath.Glob(filepath.Join(root, "cmd", "*", "main.go"))
	if len(mains) == 0 {
		if fileExists(root, "main.go") {
			return []string{"go", "run", "."}, true
		}
		return nil, false
	}
	for _, main := range mains {
		name := filepath.Base(filepath.Dir(main))
		switch name {
		case "api", "server", "web":
			continue
		}
		return []string{"go", "run", "./cmd/" + name}, true
	}
	return []string{"go", "run", "./cmd/" + filepath.Base(filepath.Dir(mains[0]))}, true
}

func pythonCLI(root string) ([]string, bool) {
	if !fileExists(root, "requirements.txt") && !fileExists(root, "pyproject.toml") {
		return nil, false
	}
	deps := ""
	for _, name := range []string{"requirements.txt", "pyproject.toml"} {
		data, err := os.ReadFile(filepath.Join(root, name))
		if err == nil {
			deps += strings.ToLower(string(data))
		}
	}
	if !strings.Contains(deps, "click") && !strings.Contains(deps, "typer") {
		return nil, false
	}
	entries, _ := os.ReadDir(root)
	for _, ent := range entries {
		if ent.IsDir() && fileExists(filepath.Join(root, ent.Name()), "__main__.py") {
			return []string{"python", "-m", ent.Name()}, true
		}
	}
	if fileExists(root, "__main__.py") {
		return []string{"python", "-m", filepath.Base(root)}, true
	}
	return nil, false
}

func fileExists(root, name string) bool {
	_, err := os.Stat(filepath.Join(root, name))
	return err == nil
}

// RunCLI execs CLICommand plus extra args. extra nil means --help.
func RunCLI(ctx context.Context, dir string, extra []string) (out string, err error) {
	bin, ok := CLICommand(dir)
	if !ok {
		return "", errNoCLI
	}
	if extra == nil {
		extra = []string{"--help"}
	}
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, cliBudget)
		defer cancel()
	}
	argv := append(append([]string{}, bin...), extra...)
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Dir = dir
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err = cmd.Run()
	b := buf.Bytes()
	if len(b) > cliOutputCap {
		b = b[len(b)-cliOutputCap:]
	}
	return string(b), err
}

var errNoCLI = errString("no CLI entrypoint in this checkout")
