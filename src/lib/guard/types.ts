import type { Finding, FindingType } from "@/lib/findings/types";

export type GuardTrigger =
  | "pull_request_merged"
  | "push_default_branch"
  | "manifest_changed"
  | "file_count_increase"
  | "manual"
  | "weekly_scheduled";

export type GuardSubscriptionStatus = "active" | "cancelled" | "expired" | "pending_payment";

export type GuardRunStatus =
  | "completed"
  | "skipped"
  | "failed"
  | "awaiting_approval"
  | "scanning";

export interface RepositoryMemory {
  id: string;
  repository: string;
  branch: string;
  protectedPaths: string[];
  allowAutomaticFixes: FindingType[];
  requireChecks: string[];
  neverAutoModify: string[];
  rejectedFindings: RejectedFindingRecord[];
  acceptedFindings: string[];
  frameworkEntryPoints: string[];
  verificationCommands: string[];
  knownPreExistingFailures: string[];
  githubInstallationId?: string;
  previousCleanupPrs: CleanupPrRecord[];
  approvalPreferences: {
    requireApprovalForPr: boolean;
  };
  notificationSettings: {
    suppressIgnoredUnlessNewEvidence: boolean;
    callbackUrl?: string;
  };
  updatedAt: string;
}

export interface RejectedFindingRecord {
  fingerprint: string;
  findingType: FindingType;
  title: string;
  rejectedAt: string;
  reason?: string;
  evidenceHash?: string;
}

export interface CleanupPrRecord {
  url: string;
  number: number;
  createdAt: string;
}

export interface GuardSubscription {
  id: string;
  recordType: "subscription";
  repository: string;
  branch: string;
  status: GuardSubscriptionStatus;
  installationId?: string;
  quoteId?: string;
  paymentReference?: string;
  priceUsdtMonthly: number;
  activatedAt: string;
  expiresAt: string;
  nextWeeklyScanAt: string;
  lastRunId?: string;
  lastAcceptedScanId?: string;
  lastAcceptedCommitSha?: string;
  monthlyPrAllowanceRemaining: number;
  createdAt: string;
  updatedAt: string;
}

export interface GuardDelta {
  previousScanId?: string;
  currentScanId: string;
  previousCommitSha?: string;
  currentCommitSha: string;
  newFindings: Finding[];
  resolvedFindings: Finding[];
  recurringFindings: Finding[];
  ignoredFindings: Finding[];
  newSafeCandidates: Finding[];
  protectedPathActivity: Finding[];
  debtTrend: {
    previousTotal: number;
    currentTotal: number;
    delta: number;
    direction: "up" | "down" | "flat";
  };
}

export interface GuardProposal {
  type: "safe_cleanup" | "cleanup_pr" | "none";
  findingIds: string[];
  reason: string;
  requiresApproval: boolean;
  monthlyAllowanceUsed: boolean;
}

export interface GuardNotification {
  id: string;
  title: string;
  summary: string;
  meaningful: boolean;
  deliveredAt: string;
  channel: "callback" | "api";
  suppressedIgnoredCount: number;
  payload?: Record<string, unknown>;
}

export interface GuardRun {
  id: string;
  recordType: "run";
  subscriptionId: string;
  repository: string;
  branch: string;
  trigger: GuardTrigger;
  commitSha: string;
  previousScanId?: string;
  currentScanId?: string;
  delta?: GuardDelta;
  status: GuardRunStatus;
  skipReason?: string;
  proposal?: GuardProposal;
  notification?: GuardNotification;
  createdAt: string;
  completedAt?: string;
}

export const MANIFEST_PATHS = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
] as const;

export const DEFAULT_REPOSITORY_MEMORY: Omit<RepositoryMemory, "id" | "repository" | "branch" | "updatedAt"> = {
  protectedPaths: ["src/auth/**", "migrations/**", "public/locales/**"],
  allowAutomaticFixes: ["unused_import", "unused_dependency"],
  requireChecks: ["typecheck", "build"],
  neverAutoModify: ["api_route", "middleware", "database_migration"],
  rejectedFindings: [],
  acceptedFindings: [],
  frameworkEntryPoints: [],
  verificationCommands: [],
  knownPreExistingFailures: [],
  previousCleanupPrs: [],
  approvalPreferences: { requireApprovalForPr: true },
  notificationSettings: { suppressIgnoredUnlessNewEvidence: true },
};
