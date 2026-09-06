export {
  analyze,
  probe,
  models,
  hostCapabilities,
  analyses,
  analysis,
  deleteAnalysis,
  analyzeBody,
  type AnalyzeEvent,
  type AnalyzeOptions,
  type AnalysisSummary,
  type ModelChoice,
  type CatalogEntry,
  type HostCapabilities,
  type ProbeRepo,
  type Recommendation,
} from "./api.ts";

export {
  eligibility,
  fitNote,
  needsKey,
  type ModelKind,
  type ModelTier,
} from "./models.ts";

export {
  apiKeyStorageKey,
  clearApiKey,
  getApiKey,
  getModelChoice,
  isAuthFailure,
  setApiKey,
  setModelChoice,
  type StoredChoice,
} from "./modelKeys.ts";
