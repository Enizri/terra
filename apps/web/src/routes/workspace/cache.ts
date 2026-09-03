import type { TerraMap } from "../../features/architecture-map";
import type { HistoryEntry } from "./history";

// Module-level cache so the workspace keeps its contents across
// route changes (landing <-> /new remounts everything). Dies on page reload;
// move to sessionStorage if that ever matters.
export const wsCache: {
  map: TerraMap | null;
  storedMap: TerraMap | null;
  history: HistoryEntry[] | null;
  /** The model this session analyzed with, so Ask reuses it. The key lives
   * here only for the tab's lifetime; localStorage is the durable copy. */
  selectedModel: { modelId: string; apiKey?: string } | null;
  /** Panel chrome, so a collapsed rail stays collapsed across a remount. */
  railOpen: boolean;
  dockOpen: boolean;
} = {
  map: null,
  storedMap: null,
  history: null,
  selectedModel: null,
  // Narrow screens get the rail as a drawer, so it starts out of the way.
  railOpen: typeof window === "undefined" || window.innerWidth > 1100,
  dockOpen: true,
};
