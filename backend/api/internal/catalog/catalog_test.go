package catalog

import "testing"

func TestAllIDsUniqueAndWellFormed(t *testing.T) {
	seen := map[string]bool{}
	tiers := map[string]bool{"fast": true, "balanced": true, "quality": true}
	for _, e := range All() {
		if seen[e.ID] {
			t.Fatalf("duplicate catalog id %q", e.ID)
		}
		seen[e.ID] = true
		if e.DisplayName == "" || e.Blurb == "" {
			t.Errorf("%s: display name and blurb are required", e.ID)
		}
		if !tiers[e.Tier] {
			t.Errorf("%s: bad tier %q", e.ID, e.Tier)
		}
		switch e.Kind {
		case KindLocal:
			if e.HFID == "" || e.MinRAMGB <= 0 || e.SizeGB <= 0 {
				t.Errorf("%s: local entry needs hf_id, min_ram_gb, size_gb", e.ID)
			}
			if e.BaseURL != "" || e.Provider != "" || e.RequiresAPIKey {
				t.Errorf("%s: local entry must not carry remote fields", e.ID)
			}
		case KindRemote:
			if e.Provider == "" || e.BaseURL == "" || e.Model == "" {
				t.Errorf("%s: remote entry needs provider, base_url, model", e.ID)
			}
			if !e.RequiresAPIKey {
				t.Errorf("%s: every v1 remote entry is BYOK", e.ID)
			}
			if e.HFID != "" {
				t.Errorf("%s: remote entry must not carry hf_id", e.ID)
			}
		default:
			t.Errorf("%s: bad kind %q", e.ID, e.Kind)
		}
	}
}

func TestFind(t *testing.T) {
	got := Find("openai-gpt-5.4-mini")
	if got == nil || got.Model != "gpt-5.4-mini" {
		t.Fatalf("Find returned %+v", got)
	}
	if Find("nope") != nil {
		t.Error("Find should return nil for an unknown id")
	}
}

// All mutates nothing shared: a caller editing the slice must not poison the catalog.
func TestAllReturnsACopy(t *testing.T) {
	All()[0].ID = "clobbered"
	if All()[0].ID == "clobbered" {
		t.Fatal("All leaked the backing array")
	}
}

func TestDetectHostShape(t *testing.T) {
	caps := DetectHost()
	switch caps.Device {
	case "mps", "cuda", "cpu":
	default:
		t.Errorf("unexpected device %q", caps.Device)
	}
	if caps.RAMGB < 0 {
		t.Errorf("negative RAM %d", caps.RAMGB)
	}
}
