package server

import (
	"fmt"
	"net/http"

	"github.com/Enizri/terra/backend/api/internal/store"
)

func (s *Server) list(w http.ResponseWriter, r *http.Request) {
	list, err := store.List(s.DB)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, list)
}

func (s *Server) get(w http.ResponseWriter, r *http.Request) {
	var id int64
	if _, err := fmt.Sscan(r.PathValue("id"), &id); err != nil {
		httpError(w, http.StatusBadRequest, "id must be a number")
		return
	}
	repoMap, err := store.Get(s.DB, id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if repoMap == nil {
		httpError(w, http.StatusNotFound, fmt.Sprintf("no analysis with id %d", id))
		return
	}
	writeJSON(w, repoMap)
}

func (s *Server) deleteAnalysis(w http.ResponseWriter, r *http.Request) {
	var id int64
	if _, err := fmt.Sscan(r.PathValue("id"), &id); err != nil {
		httpError(w, http.StatusBadRequest, "id must be a number")
		return
	}
	ok, err := store.Delete(s.DB, id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusNotFound, fmt.Sprintf("no analysis with id %d", id))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
