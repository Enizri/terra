package graph

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The wire contract between Go, the Python analyzer and the frontend is
// mirrored by hand in each language, with no codegen. This is the cheap guard:
// the golden map must still parse into the Go types with nothing important
// coming back empty. It fails when one language's copy drifts.
func TestGoldenMapParses(t *testing.T) {
	path := filepath.Join("..", "..", "case-studies", "memos.map.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read golden map: %v", err)
	}

	// "$"-prefixed keys are documentation the fixture carries for humans
	// ($schema_note); drop them so the rest can be decoded strictly.
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		t.Fatalf("golden map is not an object: %v", err)
	}
	for k := range top {
		if strings.HasPrefix(k, "$") {
			delete(top, k)
		}
	}
	stripped, err := json.Marshal(top)
	if err != nil {
		t.Fatal(err)
	}

	var m Map
	// DisallowUnknownFields: a field the analyzer emits but Go has not learned
	// about is exactly the drift this test exists to catch.
	dec := json.NewDecoder(bytes.NewReader(stripped))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		t.Fatalf("golden map does not fit graph.Map: %v", err)
	}

	if m.Project.Name == "" || m.Project.RepositoryURL == "" {
		t.Errorf("project not populated: %+v", m.Project)
	}
	if len(m.Components) == 0 || len(m.Relationships) == 0 {
		t.Fatalf("got %d components and %d relationships, want both non-empty",
			len(m.Components), len(m.Relationships))
	}
	if len(m.SuggestedQuestions) == 0 {
		t.Error("no suggested questions")
	}

	ids := make(map[string]bool, len(m.Components))
	for _, c := range m.Components {
		if c.ID == "" || c.Name == "" || c.Purpose == "" || c.Type == "" || c.Importance == "" {
			t.Errorf("component missing required fields: %+v", c)
		}
		ids[c.ID] = true
	}
	for _, c := range m.Components {
		if c.ParentID != nil && !ids[*c.ParentID] {
			t.Errorf("component %q has unknown parent %q", c.ID, *c.ParentID)
		}
	}
	for _, r := range m.Relationships {
		if !ids[r.From] || !ids[r.To] {
			t.Errorf("relationship %q -> %q references an unknown component", r.From, r.To)
		}
		if r.Type == "" {
			t.Errorf("relationship %q -> %q has no type", r.From, r.To)
		}
	}
}
