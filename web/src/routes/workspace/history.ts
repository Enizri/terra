import type { AnalysisSummary } from "../../shared/api";
import type { HistoryEntry } from "../../shared/workspace/Sidebar";

export type { HistoryEntry } from "../../shared/workspace/Sidebar";

export const HISTORY_CAP = 8;

/** Shape GET /analyses for the rail: newest first, capped (RFC3339 string sort). */
export function toHistory(rows: AnalysisSummary[]): HistoryEntry[] {
  return rows
    .map((r) => ({ id: r.id, repoUrl: r.repo_url, name: r.name, scannedAt: r.scanned_at }))
    .sort((a, b) => (a.scannedAt < b.scannedAt ? 1 : a.scannedAt > b.scannedAt ? -1 : 0))
    .slice(0, HISTORY_CAP);
}
