export type CheckRunStatus =
  | "pending"
  | "queued"
  | "in_progress"
  | "completed";

export type CheckRunConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "stale"
  | null;

export type CheckProvider = "github_actions" | "vercel" | "other";

export interface PrCheckRecord {
  checkName: string;
  provider: CheckProvider;
  status: CheckRunStatus;
  conclusion: CheckRunConclusion;
  required: boolean;
  detailsUrl?: string;
  startedAt?: string;
  completedAt?: string;
  externalId?: string;
  checkRunId?: number;
}

export type CheckFailureClassification =
  | "cleanup_regression"
  | "pre_existing_source_failure"
  | "dependency_failure"
  | "missing_environment_variable"
  | "invalid_environment_variable"
  | "provider_configuration_error"
  | "wrong_root_directory"
  | "wrong_build_command"
  | "wrong_framework_configuration"
  | "duplicate_project_integration"
  | "preview_deployment_restricted"
  | "external_service_failure"
  | "infrastructure_failure"
  | "permission_failure"
  | "unknown_failure";

export type CleanupCausedDetermination = true | false | "unknown";

export interface CheckFailureDiagnosis {
  classification: CheckFailureClassification;
  cleanupCausedThis: CleanupCausedDetermination;
  confidence: "high" | "medium" | "low";
  firstActionableError: string;
  affectedFile?: string;
  recommendedAction: string;
  logExcerpt?: string;
  logsAvailable: boolean;
  providerLogsStatus: "available" | "provider_logs_unavailable" | "not_requested";
}

export interface VercelProjectCheck {
  name: string;
  status: CheckRunStatus;
  conclusion: CheckRunConclusion;
  likelyCanonical: boolean;
  reason: string;
  deploymentUrl?: string;
  buildPhase?: string;
  environmentType?: string;
  rootDirectory?: string;
  framework?: string;
  buildCommand?: string;
}

export interface VercelProjectsSummary {
  provider: "vercel";
  projects: VercelProjectCheck[];
  ownerAction?: string;
}

export interface BaselineCheckComparison {
  checkName: string;
  baselineConclusion?: CheckRunConclusion;
  prConclusion?: CheckRunConclusion;
  baselineDiagnostic?: string;
  prDiagnostic?: string;
  sameDiagnostic: boolean;
  cleanupCausedThis: CleanupCausedDetermination;
}

export interface PrDeliveryMonitorRecord {
  taskId?: string;
  owner: string;
  repo: string;
  prNumber: number;
  prUrl: string;
  headSha: string;
  baseSha: string;
  sourceCommitSha: string;
  patchCommitSha: string;
  branch: string;
  deliveryState:
    | "monitoring_checks"
    | "checks_passed"
    | "checks_failed"
    | "diagnosis_ready"
    | "owner_action_required"
    | "delivery_ready";
  checks: PrCheckRecord[];
  diagnoses: CheckFailureDiagnosis[];
  vercelProjects?: VercelProjectsSummary;
  baselineComparisons: BaselineCheckComparison[];
  deliveryReady: boolean;
  ownerActions: string[];
  lastPolledAt: string;
  pollCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PrDeliveryReceiptChecks {
  requiredChecks: PrCheckRecord[];
  finalConclusions: Array<{ checkName: string; conclusion: CheckRunConclusion }>;
  failureClassifications: CheckFailureDiagnosis[];
  baselineComparisons: BaselineCheckComparison[];
  cleanupCausedDetermination: CleanupCausedDetermination;
  unresolvedOwnerActions: string[];
  deliveryReady: boolean;
  deliveryStatus: PrDeliveryMonitorRecord["deliveryState"];
}
