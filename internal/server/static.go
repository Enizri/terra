package server

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// static serves built UI files; missing/extensionless paths get index.html (SPA).
func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if rel == ".." || strings.HasPrefix(rel, "../") {
		http.NotFound(w, r)
		return
	}
	full := filepath.Join(s.StaticDir, filepath.FromSlash(rel))
	absRoot, err := filepath.Abs(s.StaticDir)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	absFull, err := filepath.Abs(full)
	if err != nil || (absFull != absRoot && !strings.HasPrefix(absFull, absRoot+string(filepath.Separator))) {
		http.NotFound(w, r)
		return
	}

	if filepath.Ext(rel) != "" {
		if info, err := os.Stat(full); err == nil && !info.IsDir() {
			http.ServeFile(w, r, full)
			return
		}
		// A missing asset must 404, not fall back to index.html — the SPA
		// fallback here turns stale asset references into module-MIME errors.
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, filepath.Join(s.StaticDir, "index.html"))
}
