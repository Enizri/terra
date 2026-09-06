import type { TerraMap } from "../../features/architecture-map";
import { getApiKey, getModelChoice, type ModelChoice } from "../../features/analysis";
import type { HistoryEntry } from "./history";

/** The remembered model, with its key read back out of browser storage. Ask
 * and the agent are useless without one: an empty model field leaves the
 * analyzer on the operator's env model, which is not necessarily what the
 * local sidecar has loaded. */
function restoreModel(): ModelChoice | null {
  const stored = getModelChoice();
  if (!stored) return null;
  return {
    modelId: stored.modelId,
    apiKey: getApiKey(stored.provider ?? "") || undefined,
    provider: stored.provider,
  };
}

// Module-level cache so the workspace keeps its contents across
// route changes (landing <-> /new remounts everything). Dies on page reload;
// move to sessionStorage if that ever matters.
export const wsCache: {
  map: TerraMap | null;
  storedMap: TerraMap | null;
  history: HistoryEntry[] | null;
  /** The model this session analyzed with, so Ask reuses it. The key lives
   * here only for the tab's lifetime; localStorage is the durable copy. */
  selectedModel: ModelChoice | null;
  /** Panel chrome, so a collapsed rail stays collapsed across a remount. */
  railOpen: boolean;
  dockOpen: boolean;
} = {
  map: null,
  storedMap: null,
  history: null,
  selectedModel: restoreModel(),
  // Narrow screens get the rail as a drawer, so it starts out of the way.
  railOpen: typeof window === "undefined" || window.innerWidth > 1100,
  dockOpen: true,
};
