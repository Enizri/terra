package server

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/Enizri/terra/internal/scan"
	"github.com/Enizri/terra/internal/trace"
)

// traces streams request spans for a repo as SSE (history, then live).
func (s *Server) traces(w http.ResponseWriter, r *http.Request) {
	repoURL := r.URL.Query().Get("repo_url")
	key, _, err := scan.NormalizeURL(repoURL)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	// Flush a comment so EventSource opens on a quiet stream.
	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	send := func(span trace.Span) {
		data, _ := json.Marshal(span)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}
	history, ch, cancel := trace.Subscribe(key)
	defer cancel()
	for _, span := range history {
		send(span)
	}
	for {
		select {
		case span, ok := <-ch:
			if !ok {
				return
			}
			send(span)
		case <-r.Context().Done():
			return
		}
	}
}
