/** Named durations persisted on deep-scan jobs / result summaries (milliseconds). */

export const TIMING_KEYS = [
  "dispatchDelayMs",
  "runnerQueueDelayMs",
  "claimMs",
  "archivePreparationMs",
  "archiveDownloadMs",
  "workerSetupMs",
  "inventoryMs",
  "resolvingProjectsMs",
  "buildingGraphMs",
  "jscpdMs",
  "knipMs",
  "madgeMs",
  "internalHeuristicsMs",
  "normalizingMs",
  "evidenceValidationMs",
  "artifactUploadMs",
  "completionCallbackMs",
  "resultPersistenceMs",
  "totalDurationMs",
] as const;

export type TimingKey = (typeof TIMING_KEYS)[number];

export type TimingBreakdown = Partial<Record<TimingKey, number>>;

export function mergeTimingBreakdown(
  existing: TimingBreakdown | undefined,
  patch: TimingBreakdown
): TimingBreakdown {
  return { ...(existing ?? {}), ...patch };
}

export function elapsedMs(startedAt: number, endedAt = Date.now()): number {
  return Math.max(0, Math.round(endedAt - startedAt));
}
