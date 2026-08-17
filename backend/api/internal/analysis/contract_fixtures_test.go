package analysis

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestContractFixtures ensures packages/contracts/fixtures/analysis-map.v1.json decodes
// with the same strict rules as the golden case study.
func TestContractFixtures(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..")
	path := filepath.Join(root, "packages", "contracts", "fixtures", "analysis-map.v1.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read contract fixture: %v", err)
	}
	var m Map
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		t.Fatalf("fixture does not fit analysis.Map: %v", err)
	}
	if m.Project.Name == "" || len(m.Components) == 0 {
		t.Fatalf("fixture incomplete: %+v", m.Project)
	}

	goldenPath := filepath.Join(root, "case-studies", "memos.map.json")
	goldenRaw, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatal(err)
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(goldenRaw, &top); err != nil {
		t.Fatal(err)
	}
	for k := range top {
		if strings.HasPrefix(k, "$") {
			delete(top, k)
		}
	}
	stripped, _ := json.Marshal(top)
	var fixture any
	var golden any
	json.Unmarshal(raw, &fixture)
	json.Unmarshal(stripped, &golden)
	fb, _ := json.Marshal(fixture)
	gb, _ := json.Marshal(golden)
	if string(fb) != string(gb) {
		t.Fatal("packages/contracts/fixtures/analysis-map.v1.json drifts from case-studies/memos.map.json")
	}
}

func TestDecodeMapJSONRejectsFutureVersion(t *testing.T) {
	_, err := DecodeMapJSON(`{"project":{"name":"x","repository_url":"u","description":"","kind":"","primary_languages":[],"stats":{"approx_source_files":0,"top_level_dirs":[]}},"components":[],"relationships":[],"suggested_questions":[]}`, CurrentMapVersion+1)
	if err == nil || !strings.Contains(err.Error(), "unsupported map_version") {
		t.Fatalf("err = %v", err)
	}
}
