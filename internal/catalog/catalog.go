// Package catalog is Terra's static allowlist of analyze models: local
// weights the host sidecar can load, and curated remote OpenAI-compatible
// endpoints the browser supplies a key for.
package catalog

// Kind values for Entry.Kind.
const (
	KindLocal  = "local"
	KindRemote = "remote"
)

// Entry is one selectable model. Local fields (HFID, MinRAMGB, SizeGB) are
// empty on remote entries and vice versa; the wire shape omits them.
type Entry struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"` // "local" | "remote"
	DisplayName string `json:"display_name"`
	Tier        string `json:"tier"` // "fast" | "balanced" | "quality"
	Blurb       string `json:"blurb"`

	// Local weights.
	HFID     string  `json:"hf_id,omitempty"`
	MinRAMGB int     `json:"min_ram_gb,omitempty"`
	SizeGB   float64 `json:"size_gb,omitempty"`

	// Remote endpoint.
	Provider       string `json:"provider,omitempty"`
	BaseURL        string `json:"base_url,omitempty"`
	Model          string `json:"model,omitempty"`
	RequiresAPIKey bool   `json:"requires_api_key,omitempty"`
}

// entries is the shipped catalog. Local ids are all ungated on the Hub so
// `ensure_model` can download them without an HF token.
var entries = []Entry{
	{
		ID: "local-qwen2.5-0.5b", Kind: KindLocal, DisplayName: "Qwen2.5 0.5B Instruct",
		Tier: "fast", Blurb: "Smallest local model — fine for tiny repos and smoke tests.",
		HFID: "Qwen/Qwen2.5-0.5B-Instruct", MinRAMGB: 4, SizeGB: 1.0,
	},
	{
		ID: "local-qwen2.5-1.5b", Kind: KindLocal, DisplayName: "Qwen2.5 1.5B Instruct",
		Tier: "fast", Blurb: "Quick maps of small repos on a laptop.",
		HFID: "Qwen/Qwen2.5-1.5B-Instruct", MinRAMGB: 8, SizeGB: 3.1,
	},
	{
		ID: "local-smollm2-1.7b", Kind: KindLocal, DisplayName: "SmolLM2 1.7B Instruct",
		Tier: "fast", Blurb: "Compact alternative when Qwen is unavailable.",
		HFID: "HuggingFaceTB/SmolLM2-1.7B-Instruct", MinRAMGB: 8, SizeGB: 3.4,
	},
	{
		ID: "local-qwen2.5-3b", Kind: KindLocal, DisplayName: "Qwen2.5 3B Instruct",
		Tier: "balanced", Blurb: "Good middle ground for medium repos.",
		HFID: "Qwen/Qwen2.5-3B-Instruct", MinRAMGB: 16, SizeGB: 6.2,
	},
	{
		ID: "local-qwen2.5-coder-3b", Kind: KindLocal, DisplayName: "Qwen2.5 Coder 3B",
		Tier: "balanced", Blurb: "Code-tuned; reads source layout well at 3B.",
		HFID: "Qwen/Qwen2.5-Coder-3B-Instruct", MinRAMGB: 16, SizeGB: 6.2,
	},
	{
		ID: "local-qwen2.5-7b", Kind: KindLocal, DisplayName: "Qwen2.5 7B Instruct",
		Tier: "quality", Blurb: "Best local judgement — needs a big machine.",
		HFID: "Qwen/Qwen2.5-7B-Instruct", MinRAMGB: 48, SizeGB: 15.2,
	},
	{
		ID: "local-qwen2.5-coder-7b", Kind: KindLocal, DisplayName: "Qwen2.5 Coder 7B",
		Tier: "quality", Blurb: "Code-tuned 7B for large, layered codebases.",
		HFID: "Qwen/Qwen2.5-Coder-7B-Instruct", MinRAMGB: 48, SizeGB: 15.2,
	},

	{
		ID: "openai-gpt-5.4-mini", Kind: KindRemote, DisplayName: "OpenAI GPT-5.4 mini",
		Tier: "balanced", Blurb: "Cheap hosted model; nothing to download.",
		Provider: "openai", BaseURL: "https://api.openai.com/v1",
		Model: "gpt-5.4-mini", RequiresAPIKey: true,
	},
	{
		ID: "openai-gpt-5.4", Kind: KindRemote, DisplayName: "OpenAI GPT-5.4",
		Tier: "quality", Blurb: "Strongest curated remote for large repos.",
		Provider: "openai", BaseURL: "https://api.openai.com/v1",
		Model: "gpt-5.4", RequiresAPIKey: true,
	},
	{
		ID: "groq-llama-3.3-70b", Kind: KindRemote, DisplayName: "Llama 3.3 70B (Groq)",
		Tier: "quality", Blurb: "Very fast hosted inference on Groq.",
		Provider: "groq", BaseURL: "https://api.groq.com/openai/v1",
		Model: "llama-3.3-70b-versatile", RequiresAPIKey: true,
	},
	{
		ID: "openrouter-claude-sonnet", Kind: KindRemote, DisplayName: "Claude Sonnet 4.5 (OpenRouter)",
		Tier: "quality", Blurb: "Routed through OpenRouter with your own key.",
		Provider: "openrouter", BaseURL: "https://openrouter.ai/api/v1",
		Model: "anthropic/claude-sonnet-4.5", RequiresAPIKey: true,
	},
}

// All returns the catalog in display order.
func All() []Entry {
	out := make([]Entry, len(entries))
	copy(out, entries)
	return out
}

// Find returns the entry with id, or nil.
func Find(id string) *Entry {
	for i := range entries {
		if entries[i].ID == id {
			e := entries[i]
			return &e
		}
	}
	return nil
}
