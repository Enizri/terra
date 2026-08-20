package analysis

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// CurrentMapVersion is written with every new analysis row.
const CurrentMapVersion = 1

// DecodeMapJSON unmarshals map_json according to mapVersion.
// Unsupported future versions return a precise error; version 0/1 are v1.
func DecodeMapJSON(mapJSON string, mapVersion int) (*Map, error) {
	if mapVersion < 0 {
		return nil, fmt.Errorf("corrupt map_version %d", mapVersion)
	}
	if mapVersion > CurrentMapVersion {
		return nil, fmt.Errorf("unsupported map_version %d (this Terra build understands up to %d); upgrade Terra or re-analyze", mapVersion, CurrentMapVersion)
	}
	// v0 legacy rows and v1 share the same JSON shape.
	var m Map
	dec := json.NewDecoder(bytes.NewReader([]byte(mapJSON)))
	if err := dec.Decode(&m); err != nil {
		return nil, fmt.Errorf("map_json is corrupt: %w", err)
	}
	return &m, nil
}
