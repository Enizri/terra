package recommend

import (
	"slices"
	"testing"

	"github.com/Enizri/terra/backend/api/internal/catalog"
	"github.com/Enizri/terra/backend/api/internal/scan"
)

var (
	bigMachine   = catalog.Capabilities{RAMGB: 64, Device: "mps"}
	smallMachine = catalog.Capabilities{RAMGB: 8, Device: "cpu"}
	unknownHost  = catalog.Capabilities{}
)

func TestTierFromSignals(t *testing.T) {
	cases := []struct {
		name string
		sig  Signals
		want string
	}{
		{"tiny repo", Signals{SourceFiles: 40, TopLevelDirs: 4}, "fast"},
		{"medium repo", Signals{SourceFiles: 700, TopLevelDirs: 9}, "balanced"},
		{"monorepo by file count", Signals{SourceFiles: 4000, TopLevelDirs: 30}, "quality"},
		{"small file count but sprawling layout", Signals{SourceFiles: 200, TopLevelDirs: 40}, "balanced"},
		{"provisional: metadata size only", Signals{SizeKB: 600}, "fast"},
		{"provisional: huge metadata size", Signals{SizeKB: 200_000}, "quality"},
		{"nothing known", Signals{}, "balanced"},
	}
	for _, tc := range cases {
		if got := tc.sig.tier(); got != tc.want {
			t.Errorf("%s: tier = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestEligibleFiltersLocalsByRAM(t *testing.T) {
	big := *catalog.Find("local-qwen2.5-7b")
	small := *catalog.Find("local-qwen2.5-0.5b")

	if ok, _ := Eligible(big, smallMachine); ok {
		t.Error("a 32 GB model must not be eligible on an 8 GB machine")
	}
	if ok, hint := Eligible(big, smallMachine); hint == "" && !ok {
		t.Error("an ineligible entry must explain itself")
	}
	if ok, _ := Eligible(small, smallMachine); !ok {
		t.Error("the smallest local model must run on an 8 GB machine")
	}
	if ok, _ := Eligible(big, unknownHost); ok {
		t.Error("unknown host memory must not clear a 32 GB model")
	}
	// Remote entries never depend on the host.
	if ok, _ := Eligible(*catalog.Find("openai-gpt-5.4"), smallMachine); !ok {
		t.Error("remote entries are always eligible")
	}
}

func TestRecommendNeverPicksAnIneligibleModel(t *testing.T) {
	for _, caps := range []catalog.Capabilities{bigMachine, smallMachine, unknownHost} {
		for _, sig := range []Signals{{SourceFiles: 20}, {SourceFiles: 800}, {SourceFiles: 9000}} {
			rec := Recommend(catalog.All(), caps, sig)
			picked := catalog.Find(rec.ModelID)
			if picked == nil {
				t.Fatalf("caps %+v sig %+v: recommended unknown id %q", caps, sig, rec.ModelID)
			}
			if ok, hint := Eligible(*picked, caps); !ok {
				t.Errorf("caps %+v: recommended %s which %s", caps, rec.ModelID, hint)
			}
			for _, alt := range rec.Alternatives {
				entry := catalog.Find(alt)
				if entry == nil {
					t.Errorf("alternative %q is not in the catalog", alt)
					continue
				}
				if ok, _ := Eligible(*entry, caps); !ok {
					t.Errorf("caps %+v: offered ineligible alternative %s", caps, alt)
				}
			}
			if slices.Contains(rec.Alternatives, rec.ModelID) {
				t.Error("the recommendation must not repeat itself as an alternative")
			}
			if rec.Reason == "" {
				t.Error("every recommendation needs a reason")
			}
		}
	}
}

func TestRecommendPrefersLocalOnACapableMachine(t *testing.T) {
	rec := Recommend(catalog.All(), bigMachine, Signals{SourceFiles: 120, TopLevelDirs: 5})
	entry := catalog.Find(rec.ModelID)
	if entry.Kind != catalog.KindLocal {
		t.Errorf("small repo on a big machine picked %s (%s), want a local model", rec.ModelID, entry.Kind)
	}
	if entry.Tier != "fast" {
		t.Errorf("small repo picked the %s tier, want fast", entry.Tier)
	}
}

// The smallest weights win on download cost alone, and nothing else rewards
// capability inside a tier — so without the floor a tiny repo on a 64 GB box
// gets a 0.5B model.
func TestRecommendSkipsTheSmallestLocalWhenTheHostCanDoBetter(t *testing.T) {
	rec := Recommend(catalog.All(), bigMachine, Signals{SourceFiles: 2, TopLevelDirs: 1})
	if rec.ModelID == "local-qwen2.5-0.5b" {
		t.Error("a capable machine should not default to the 0.5B model")
	}
	if entry := catalog.Find(rec.ModelID); entry.Kind != catalog.KindLocal {
		t.Errorf("tiny repo on a big machine picked %s (%s), want a local model", rec.ModelID, entry.Kind)
	}
}

// Under-powering the repo is worse than being slow: a fast-tier model on a
// balanced-tier repo produces a wrong map.
func TestRecommendPrefersACapableLocalForAMediumRepoOnCPU(t *testing.T) {
	caps := catalog.Capabilities{RAMGB: 32, Device: "cpu"}
	rec := Recommend(catalog.All(), caps, Signals{SourceFiles: 1000, TopLevelDirs: 8})
	entry := catalog.Find(rec.ModelID)
	if entry.Kind != catalog.KindLocal || entry.Tier != "balanced" {
		t.Errorf("1000-file repo on a 32 GB CPU box picked %s (%s/%s), want a balanced local",
			rec.ModelID, entry.Kind, entry.Tier)
	}
}

// The floor must not push a small machine onto a paid remote. Quantized
// weights put three fast-tier locals inside 4 GB, so what matters is that one
// of them wins, not which.
func TestRecommendStillPicksALocalOnASmallMachine(t *testing.T) {
	caps := catalog.Capabilities{RAMGB: 4, Device: "cpu"}
	rec := Recommend(catalog.All(), caps, Signals{SourceFiles: 20})
	entry := catalog.Find(rec.ModelID)
	if entry == nil || entry.Kind != catalog.KindLocal {
		t.Fatalf("a 4 GB box picked %s, want a local", rec.ModelID)
	}
	if ok, why := Eligible(*entry, caps); !ok {
		t.Errorf("recommended %s on 4 GB, which is not eligible: %s", rec.ModelID, why)
	}
}

func TestRecommendSendsBigReposRemoteFromASmallMachine(t *testing.T) {
	rec := Recommend(catalog.All(), smallMachine, Signals{SourceFiles: 9000, TopLevelDirs: 30})
	entry := catalog.Find(rec.ModelID)
	if entry.Kind != catalog.KindRemote {
		t.Errorf("huge repo on an 8 GB CPU box picked %s (%s), want a remote model",
			rec.ModelID, entry.Kind)
	}
}

func TestRecommendWithAnEmptyCatalog(t *testing.T) {
	rec := Recommend(nil, bigMachine, Signals{SourceFiles: 10})
	if rec.ModelID != "" || rec.Reason == "" {
		t.Errorf("empty catalog should yield no id and an explanation, got %+v", rec)
	}
}

func TestFromScan(t *testing.T) {
	sig := FromScan(&scan.Result{
		PrimaryLanguages: []string{"Go"},
		Stats:            scan.Stats{SourceFiles: 42, TotalBytes: 1234, TopLevelDirs: []string{"a", "b"}},
	})
	if sig.SourceFiles != 42 || sig.TopLevelDirs != 2 || sig.TotalBytes != 1234 {
		t.Errorf("FromScan = %+v", sig)
	}
	if zero := FromScan(nil); zero.SourceFiles != 0 || zero.Languages != nil {
		t.Errorf("FromScan(nil) = %+v, want zero signals", zero)
	}
}

// The BYOK friction penalty used to be cancelled by a flat bonus for
// quality-tier repos, which put every remote above every local no matter how
// capable the host — a workstation that could run 7B locally was still told to
// go and buy an API key.
func TestRecommendOffersALocalForABigRepoOnACapableMachine(t *testing.T) {
	// A Q4_K_M 7B is ~4.7 GB mmapped plus its KV cache, so 16 GB is plenty —
	// this used to need 48 GB as an fp16 checkpoint.
	for _, caps := range []catalog.Capabilities{
		{RAMGB: 16, Device: "mps"},
		{RAMGB: 32, Device: "mps"},
		{RAMGB: 64, Device: "mps"},
		{RAMGB: 128, Device: "cuda"},
	} {
		rec := Recommend(catalog.All(), caps, Signals{SourceFiles: 9000, TopLevelDirs: 30})
		entry := catalog.Find(rec.ModelID)
		if entry == nil {
			t.Fatalf("%dGB/%s: unknown model %q", caps.RAMGB, caps.Device, rec.ModelID)
		}
		if entry.Kind != catalog.KindLocal {
			t.Errorf("%dGB/%s: recommended %s, want a local model this host can run",
				caps.RAMGB, caps.Device, rec.ModelID)
		}
		if entry.Tier != "quality" {
			t.Errorf("%dGB/%s: recommended tier %q, want quality for a 9000-file repo",
				caps.RAMGB, caps.Device, entry.Tier)
		}
	}
}

// The other direction: dropping the bonus must not make a remote unreachable
// when no local can actually do the work.
func TestRecommendStillGoesRemoteWhenNoLocalCanDoTheJob(t *testing.T) {
	big := Signals{SourceFiles: 9000, TopLevelDirs: 30}
	for _, tc := range []struct {
		name string
		caps catalog.Capabilities
	}{
		{"8GB is under the quantized 7B floor", catalog.Capabilities{RAMGB: 8, Device: "mps"}},
		{"CPU-only inference is too slow", catalog.Capabilities{RAMGB: 32, Device: "cpu"}},
	} {
		rec := Recommend(catalog.All(), tc.caps, big)
		entry := catalog.Find(rec.ModelID)
		if entry == nil {
			t.Fatalf("%s: unknown model %q", tc.name, rec.ModelID)
		}
		if entry.Kind != catalog.KindRemote {
			t.Errorf("%s: recommended %s, want a remote", tc.name, rec.ModelID)
		}
	}
}
