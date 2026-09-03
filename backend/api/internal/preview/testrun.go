package preview

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const testBudget = 3 * time.Minute
const testOutputCap = 64 << 10

// TestCommand is the argv Terra runs for "Run tests" on a package stage.
func TestCommand(root string) (argv []string, ok bool) {
	data, err := os.ReadFile(filepath.Join(root, "package.json"))
	if err == nil {
		var pkg struct {
			Scripts map[string]string `json:"scripts"`
		}
		if json.Unmarshal(data, &pkg) == nil && pkg.Scripts["test"] != "" {
			pm := "npm"
			if exists(root, "yarn.lock") {
				pm = "yarn"
			} else if exists(root, "pnpm-lock.yaml") {
				pm = "pnpm"
			}
			return []string{pm, "test"}, true
		}
	}
	if exists(root, "go.mod") {
		return []string{"go", "test", "./..."}, true
	}
	if exists(root, "pytest.ini") || exists(root, "pyproject.toml") {
		return []string{"pytest", "-q"}, true
	}
	return nil, false
}

func exists(root, name string) bool {
	_, err := os.Stat(filepath.Join(root, name))
	return err == nil
}

// RunTests execs TestCommand in dir and returns truncated combined output.
func RunTests(ctx context.Context, dir string) (out string, err error) {
	argv, ok := TestCommand(dir)
	if !ok {
		return "", errNoTests
	}
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, testBudget)
		defer cancel()
	}
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Dir = dir
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err = cmd.Run()
	b := buf.Bytes()
	if len(b) > testOutputCap {
		b = b[len(b)-testOutputCap:]
	}
	return string(b), err
}

var errNoTests = errString("no test script in this checkout")

type errString string

func (e errString) Error() string { return string(e) }
