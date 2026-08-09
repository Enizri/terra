import type { TerraMap } from "../../shared/map/types";
import type { HistoryEntry } from "./history";

// ponytail: module-level cache so the workspace keeps its contents across
// route changes (landing <-> /new remounts everything). Dies on page reload;
// move to sessionStorage if that ever matters.
export const wsCache: {
  map: TerraMap | null;
  storedMap: TerraMap | null;
  history: HistoryEntry[] | null;
  /** The model this session analyzed with, so Ask reuses it. The key lives
   * here only for the tab's lifetime; localStorage is the durable copy. */
  selectedModel: { modelId: string; apiKey?: string } | null;
} = { map: null, storedMap: null, history: null, selectedModel: null };
