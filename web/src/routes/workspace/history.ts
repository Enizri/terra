import type { AnalysisSummary } from "../../shared/api";

/** A stored analysis shown in the rail — clicking one loads its saved map. */
export type HistoryEntry = { id: number; repoUrl: string; name: string; scannedAt: string };

/** The rail shows at most this many rows — the store keeps the rest. */
export const HISTORY_CAP = 8;

/**
 * Shape GET /analyses rows for the sidebar: newest first, capped. The server
 * already orders by scanned_at DESC, but the sort here means the rail never
 * depends on that — scanned_at is RFC3339 UTC, so string compare is enough.
 */
export function toHistory(rows: AnalysisSummary[]): HistoryEntry[] {
  return rows
    .map((r) => ({ id: r.id, repoUrl: r.repo_url, name: r.name, scannedAt: r.scanned_at }))
    .sort((a, b) => (a.scannedAt < b.scannedAt ? 1 : a.scannedAt > b.scannedAt ? -1 : 0))
    .slice(0, HISTORY_CAP);
}
