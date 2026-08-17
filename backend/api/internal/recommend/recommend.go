// Package recommend picks a default analyze model from repo complexity and
// host capability. Rules only — no LLM, no network, no I/O.
package recommend

import (
	"fmt"
	"sort"

	"github.com/Enizri/terra/backend/api/internal/catalog"
	"github.com/Enizri/terra/backend/api/internal/scan"
)

// Signals is what the recommender knows about a repo. A provisional call
// (GitHub metadata only) fills Languages and SizeKB; the refined call after
// the no-LLM scan fills the rest.
type Signals struct {
	Languages    []string `json:"languages,omitempty"`
	SizeKB       int64    `json:"size_kb,omitempty"`
	SourceFiles  int      `json:"source_files,omitempty"`
	TotalBytes   int64    `json:"total_bytes,omitempty"`
	TopLevelDirs int      `json:"top_level_dirs,omitempty"`
}

// RepoInfo is the repo identity carried on the probe's done event.
type RepoInfo struct {
	URL       string   `json:"url"`
	Commit    string   `json:"commit,omitempty"`
	Languages []string `json:"languages,omitempty"`
}

// Recommendation is the picker's default plus two runners-up.
type Recommendation struct {
	ModelID      string   `json:"model_id"`
	Reason       string   `json:"reason"`
	Alternatives []string `json:"alternatives,omitempty"`
	// Tier is the complexity band the repo landed in.
	Tier string `json:"tier"`
}

// FromScan reads the refined signals off a completed no-LLM scan.
func FromScan(res *scan.Result) Signals {
	if res == nil {
		return Signals{}
	}
	sig := Signals{
		SourceFiles:  res.Stats.SourceFiles,
		TotalBytes:   res.Stats.TotalBytes,
		TopLevelDirs: len(res.Stats.TopLevelDirs),
		Languages:    res.PrimaryLanguages,
	}
	return sig
}

// tier maps repo size onto the catalog's fast/balanced/quality bands. File
// count is the honest signal; SizeKB (GitHub metadata) stands in before the
// scan has run.
func (s Signals) tier() string {
	files := s.SourceFiles
	if files == 0 && s.SizeKB > 0 {
		// GitHub reports the packed repo size; ~12 KB per source file is a
		// rough but stable stand-in until the scan lands.
		files = int(s.SizeKB / 12)
	}
	switch {
	case files == 0:
		return "balanced" // nothing known yet: don't bias either way
	case files < 300 && s.TopLevelDirs <= 12:
		return "fast"
	case files < 1500:
		return "balanced"
	default:
		return "quality"
	}
}

var tierRank = map[string]int{"fast": 0, "balanced": 1, "quality": 2}

// Eligible reports whether caps can run entry, and why not when they cannot.
// Remote entries are always eligible — they run on someone else's hardware.
func Eligible(entry catalog.Entry, caps catalog.Capabilities) (bool, string) {
	if entry.Kind != catalog.KindLocal {
		return true, ""
	}
	if caps.RAMGB > 0 && caps.RAMGB < entry.MinRAMGB {
		return false, fmt.Sprintf("needs ~%d GB RAM (this machine has %d GB)", entry.MinRAMGB, caps.RAMGB)
	}
	// A quantized 7B fits in RAM on a CPU-only host — it just generates at a
	// handful of tokens a second, and a repo map is thousands of tokens. That
	// is a wait nobody sits through, so keep it out of the picker entirely
	// rather than let someone pick it and conclude Terra is broken.
	if caps.Device == "cpu" && tierRank[entry.Tier] > 1 {
		return false, "too slow without a GPU or Apple Silicon — pick a smaller local model or a hosted one"
	}
	if caps.RAMGB == 0 {
		// Unknown host: only clear the smallest weights rather than promising
		// a 7B download that may OOM.
		if entry.MinRAMGB > 8 {
			return false, fmt.Sprintf("needs ~%d GB RAM (host memory unknown)", entry.MinRAMGB)
		}
	}
	return true, ""
}

// score ranks one eligible entry for a repo of the given tier: task fit,
// minus a host penalty for pushing the machine, minus download cost.
func score(entry catalog.Entry, caps catalog.Capabilities, want string) float64 {
	// Tier fit is asymmetric: an over-powered model is merely slow, an
	// under-powered one produces a wrong map.
	step := 3
	gap := tierRank[entry.Tier] - tierRank[want]
	if gap < 0 {
		step = 7
	}
	s := float64(10 - step*abs(gap))

	if entry.Kind == catalog.KindLocal {
		// Prefer local: no key, no bill, no data leaving the host.
		s += 2
		// Download cost — a first run pays for every gigabyte.
		s -= entry.SizeGB * 0.25
		// Nothing else rewards capability within a tier, so the smallest
		// weights would always win. The 0.5B stays selectable and eligible —
		// just never the default. (Threshold is in Q4_K_M gigabytes: the
		// next model up is 1.1 GB.)
		if entry.SizeGB < 0.7 {
			s -= 4
		}
		// Headroom is not scored here: MinRAMGB already covers the mmapped
		// weights plus the KV cache, so Eligible rejects what will not fit —
		// a penalty could only ever demote, never block.
		if caps.Device == "cpu" && tierRank[entry.Tier] > 0 {
			s -= 2
		}
	} else {
		// A BYOK key modal, a provider account and a per-run bill are real
		// friction. No bonus for big repos: a machine that can comfortably
		// run the matching local model should be offered it, and the local
		// candidates already lose their own points to download size and
		// CPU-only inference when they cannot.
		s -= 3
	}
	return s
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// Recommend picks a default from entries for sig on caps. Entries the host
// cannot run are excluded. An empty catalog yields an empty ModelID.
func Recommend(entries []catalog.Entry, caps catalog.Capabilities, sig Signals) Recommendation {
	want := sig.tier()

	type scored struct {
		entry catalog.Entry
		score float64
	}
	var ranked []scored
	for _, e := range entries {
		if ok, _ := Eligible(e, caps); !ok {
			continue
		}
		ranked = append(ranked, scored{e, score(e, caps, want)})
	}
	// Stable order: score desc, then catalog order (SliceStable preserves it).
	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })

	rec := Recommendation{Tier: want}
	if len(ranked) == 0 {
		rec.Reason = "No model in the catalog fits this machine — add RAM or pick a remote model."
		return rec
	}
	best := ranked[0].entry
	rec.ModelID = best.ID
	rec.Reason = reason(best, want, sig)
	for _, alt := range ranked[1:min(3, len(ranked))] {
		rec.Alternatives = append(rec.Alternatives, alt.entry.ID)
	}
	return rec
}

func reason(entry catalog.Entry, want string, sig Signals) string {
	size := "a repo of unknown size"
	if sig.SourceFiles > 0 {
		size = fmt.Sprintf("%d source files", sig.SourceFiles)
	} else if sig.SizeKB > 0 {
		size = fmt.Sprintf("roughly %d MB of repository", sig.SizeKB/1024)
	}
	where := "runs on this machine, nothing to pay for"
	if entry.Kind == catalog.KindRemote {
		where = "hosted, so nothing to download"
	}
	return fmt.Sprintf("%s reads %s well (%s tier) and %s.", entry.DisplayName, size, want, where)
}
