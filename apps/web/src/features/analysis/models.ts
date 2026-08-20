/** Model catalog types and the pure rules the picker renders (GET /models,
 * GET /host/capabilities). Mirrors backend/api/internal/catalog. */

export type ModelKind = "local" | "remote";
export type ModelTier = "fast" | "balanced" | "quality";

export type CatalogEntry = {
  id: string;
  kind: ModelKind;
  display_name: string;
  tier: ModelTier;
  blurb: string;
  /** local */
  hf_id?: string;
  min_ram_gb?: number;
  size_gb?: number;
  /** remote */
  provider?: string;
  base_url?: string;
  model?: string;
  requires_api_key?: boolean;
};

export type HostCapabilities = {
  ram_gb: number;
  device: "mps" | "cuda" | "cpu" | string;
  vram_gb?: number;
};

export type Recommendation = {
  model_id: string;
  reason: string;
  alternatives?: string[];
  tier: ModelTier;
};

export type ProbeRepo = {
  url: string;
  commit?: string;
  languages?: string[];
};

/** Mirror of recommend.Eligible: remote entries always run, local ones need
 * the RAM. An unknown host (0 GB) only clears the small weights, and a
 * CPU-only host never clears the quality tier (tokens/sec, not memory). */
export function eligibility(
  entry: CatalogEntry,
  caps: HostCapabilities | null,
): { eligible: boolean; hint: string } {
  if (entry.kind !== "local") return { eligible: true, hint: "" };
  const need = entry.min_ram_gb ?? 0;
  const have = caps?.ram_gb ?? 0;
  if (have > 0 && have < need) {
    return { eligible: false, hint: `needs ~${need} GB RAM (this machine has ${have} GB)` };
  }
  if (caps?.device === "cpu" && entry.tier === "quality") {
    return { eligible: false, hint: "too slow without a GPU or Apple Silicon — pick a smaller local model or a hosted one" };
  }
  if (have === 0 && need > 8) {
    return { eligible: false, hint: `needs ~${need} GB RAM (host memory unknown)` };
  }
  return { eligible: true, hint: "" };
}

/** One line under the model name: what running it here actually costs. */
export function fitNote(entry: CatalogEntry, caps: HostCapabilities | null): string {
  if (entry.kind === "remote") {
    return `Runs on ${entry.provider ?? "the provider"} — needs your API key`;
  }
  const size = entry.size_gb ? `~${entry.size_gb} GB download` : "downloads on first use";
  const device = caps?.device ? ` on ${caps.device}` : "";
  return `Runs here${device}, ${size}`;
}

/** Whether picking this entry needs a key the browser does not have yet. */
export function needsKey(entry: CatalogEntry, storedKey: string): boolean {
  return Boolean(entry.requires_api_key) && !storedKey.trim();
}

export type AnalyzeOptions = {
  repoUrl: string;
  /** Reuses the probe's scan when it is still cached. */
  probeId?: string;
  modelId?: string;
  apiKey?: string;
};

/** Only non-empty fields go on the wire: an unrouted analyze must look
 * exactly like it did before the picker existed. */
export function analyzeBody(opts: AnalyzeOptions): Record<string, string> {
  const body: Record<string, string> = { repo_url: opts.repoUrl };
  if (opts.probeId) body.probe_id = opts.probeId;
  if (opts.modelId) body.model_id = opts.modelId;
  if (opts.apiKey?.trim()) body.api_key = opts.apiKey.trim();
  return body;
}
