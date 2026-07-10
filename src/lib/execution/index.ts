export {
  scanRepository,
  analyzeRepository,
  selectSafeFixes,
  generateChanges,
  verifyChanges,
  createCleanupPullRequest,
  createTaskQuote,
  createExecutionReceipt,
  executeFreeProof,
  executeTaskQuote,
  runQuickCleanup,
  activateRepoGuard,
  runGuardScan,
  getRepoGuardStatus,
} from "./cleanup-engine";

export type { TaskOperation, TaskQuote, FreeCleanupResult, ExecutionReceipt } from "./cleanup-engine";
