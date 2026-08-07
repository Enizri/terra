import type { TerraMap } from "../../shared/map/types";
import type { HistoryEntry } from "./history";

// ponytail: module-level cache so the workspace keeps its contents across
// route changes (landing <-> /new remounts everything). Dies on page reload;
// move to sessionStorage if that ever matters.
export const wsCache: {
  map: TerraMap | null;
  storedMap: TerraMap | null;
  history: HistoryEntry[] | null;
} = { map: null, storedMap: null, history: null };
