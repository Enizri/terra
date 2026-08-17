/** One stored analysis in the shell rail — domain type, not UI. */
export type HistoryEntry = {
  id: number;
  repoUrl: string;
  name: string;
  scannedAt: string;
};
