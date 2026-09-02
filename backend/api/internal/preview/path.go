package preview

import (
	"fmt"
	"path"
	"path/filepath"
	"strings"
)

// maxPatchBytes caps a unified diff and the file it produces. Same 512 KiB
// ceiling GET /files uses when reading a previewed source file.
const maxPatchBytes = 512 << 10

// SafeJoin resolves rel under base and rejects path escape (including
// symlinks). This is the trust boundary shared by GET /files and ApplyPatch.
func SafeJoin(base, rel string) (full, clean string, err error) {
	clean = path.Clean("/" + strings.TrimPrefix(rel, "/"))[1:]
	realBase, err := filepath.EvalSymlinks(base)
	if err != nil {
		return "", "", fmt.Errorf("preview checkout unavailable")
	}
	full = filepath.Join(realBase, filepath.FromSlash(clean))
	if realFull, err := filepath.EvalSymlinks(full); err == nil {
		relPath, err := filepath.Rel(realBase, realFull)
		if err != nil || relPath == ".." || strings.HasPrefix(relPath, ".."+string(filepath.Separator)) {
			return "", "", fmt.Errorf("path escapes the repository")
		}
	}
	return full, clean, nil
}

func contained(realBase, p string) bool {
	rel, err := filepath.Rel(realBase, p)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false
	}
	return true
}
