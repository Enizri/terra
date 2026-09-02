package preview

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
)

var hunkHeader = regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@`)

func (r *hostRunner) ApplyPatch(repoURL, path, unifiedDiff string) error {
	root, _, ok := r.Lookup(repoURL)
	if !ok {
		return fmt.Errorf("preview checkout is not ready")
	}
	return applyToCheckout(root, path, unifiedDiff)
}

func (r *dockerRunner) ApplyPatch(repoURL, path, unifiedDiff string) error {
	root, _, ok := r.Lookup(repoURL)
	if !ok {
		return fmt.Errorf("preview checkout is not ready")
	}
	return applyToCheckout(root, path, unifiedDiff)
}

func (r invalidRunner) ApplyPatch(string, string, string) error {
	return fmt.Errorf("unknown TERRA_PREVIEW_MODE %q (want host or docker)", r.mode)
}

// applyToCheckout writes a unified diff under checkout root. It uses SafeJoin,
// refuses symlink targets, and caps patch/result size. It does not git commit.
func applyToCheckout(root, rel, diff string) error {
	if strings.TrimSpace(rel) == "" {
		return fmt.Errorf("path is required")
	}
	if len(diff) > maxPatchBytes {
		return fmt.Errorf("patch too large")
	}
	full, clean, err := SafeJoin(root, rel)
	if err != nil {
		return err
	}
	if clean == "" {
		return fmt.Errorf("path is required")
	}
	realBase, err := filepath.EvalSymlinks(root)
	if err != nil {
		return fmt.Errorf("preview checkout unavailable")
	}
	if !contained(realBase, full) {
		return fmt.Errorf("path escapes the repository")
	}
	if err := ensureParentsContained(realBase, filepath.Dir(full)); err != nil {
		return err
	}
	info, err := os.Lstat(full)
	if err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("path escapes the repository")
		}
		if info.IsDir() {
			return fmt.Errorf("path is a directory, not a file")
		}
		if info.Size() > maxPatchBytes {
			return fmt.Errorf("file too large")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	original := ""
	if err == nil {
		data, readErr := os.ReadFile(full)
		if readErr != nil {
			return readErr
		}
		original = string(data)
	}
	patched, err := applyUnified(original, diff)
	if err != nil {
		return err
	}
	if len(patched) > maxPatchBytes {
		return fmt.Errorf("file too large")
	}
	return writeNoFollow(full, []byte(patched))
}

func ensureParentsContained(realBase, dir string) error {
	rel, err := filepath.Rel(realBase, dir)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("path escapes the repository")
	}
	if rel == "." {
		return nil
	}
	cur := realBase
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		if part == "" || part == "." {
			continue
		}
		next := filepath.Join(cur, part)
		info, err := os.Lstat(next)
		if os.IsNotExist(err) {
			if err := os.Mkdir(next, 0o755); err != nil {
				return err
			}
			cur = next
			continue
		}
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			resolved, err := filepath.EvalSymlinks(next)
			if err != nil || !contained(realBase, resolved) {
				return fmt.Errorf("path escapes the repository")
			}
			cur = resolved
			continue
		}
		if !info.IsDir() {
			return fmt.Errorf("path escapes the repository")
		}
		cur = next
	}
	return nil
}

func writeNoFollow(path string, data []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC|syscall.O_NOFOLLOW, 0o644)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	return err
}

type hunk struct {
	oldStart int
	lines    []string
}

func applyUnified(original, diff string) (string, error) {
	hunks, err := parseUnified(diff)
	if err != nil {
		return "", err
	}
	if len(hunks) == 0 {
		return "", fmt.Errorf("unified diff has no hunks")
	}
	src := splitLines(original)
	var out []string
	pos := 0
	for _, h := range hunks {
		start := h.oldStart
		if start > 0 {
			start--
		}
		if start < pos || start > len(src) {
			return "", fmt.Errorf("patch does not apply")
		}
		out = append(out, src[pos:start]...)
		pos = start
		for _, raw := range h.lines {
			if strings.HasPrefix(raw, "\\") {
				continue
			}
			if raw == "" {
				raw = " "
			}
			prefix, body := raw[0], raw[1:]
			switch prefix {
			case ' ':
				if pos >= len(src) || src[pos] != body {
					return "", fmt.Errorf("patch does not apply")
				}
				out = append(out, body)
				pos++
			case '-':
				if pos >= len(src) || src[pos] != body {
					return "", fmt.Errorf("patch does not apply")
				}
				pos++
			case '+':
				out = append(out, body)
			default:
				return "", fmt.Errorf("malformed unified diff")
			}
		}
	}
	out = append(out, src[pos:]...)
	if len(out) == 0 {
		return "", nil
	}
	return strings.Join(out, "\n") + "\n", nil
}

func parseUnified(diff string) ([]hunk, error) {
	raw := strings.ReplaceAll(diff, "\r\n", "\n")
	lines := strings.Split(raw, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	var hunks []hunk
	var cur *hunk
	for _, line := range lines {
		if strings.HasPrefix(line, "---") || strings.HasPrefix(line, "+++") ||
			strings.HasPrefix(line, "diff ") || strings.HasPrefix(line, "index ") {
			continue
		}
		if m := hunkHeader.FindStringSubmatch(line); m != nil {
			if cur != nil {
				hunks = append(hunks, *cur)
			}
			oldStart, _ := strconv.Atoi(m[1])
			cur = &hunk{oldStart: oldStart}
			continue
		}
		if cur == nil {
			continue
		}
		if line == "" {
			cur.lines = append(cur.lines, " ")
			continue
		}
		switch line[0] {
		case ' ', '-', '+', '\\':
			cur.lines = append(cur.lines, line)
		default:
			hunks = append(hunks, *cur)
			cur = nil
		}
	}
	if cur != nil {
		hunks = append(hunks, *cur)
	}
	return hunks, nil
}

func splitLines(s string) []string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.TrimSuffix(s, "\n")
	if s == "" {
		return nil
	}
	return strings.Split(s, "\n")
}
