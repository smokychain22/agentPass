import { nanoid } from "nanoid";
import type { Finding } from "@/lib/findings/types";
import { isCleanupEligible } from "@/lib/findings/cleanup-eligibility";
import type {
  EvidenceFact,
  PlanAnalysisStatus,
  RequestedAction,
  TransformationPlan,
} from "./types";
import { pathFromId, pathIndicators, normalizeTrackedPath } from "./path-identity";
import { hashNormalizedPatch, hashTransformationPlan } from "./plan-hash";

export interface AnalyzeRequestedActionInput {
  action: RequestedAction;
  findings?: Finding[];
  /** Optional precomputed unified diff from isolated preflight */
  unifiedDiff?: string;
  transformerId?: string;
  transformerAvailable?: boolean;
  validationCommands?: string[];
}

function findingsForPaths(findings: Finding[] | undefined, paths: string[]): Finding[] {
  if (!findings?.length) return [];
  const set = new Set(paths.map(normalizeTrackedPath));
  return findings.filter((f) => f.files.some((file) => set.has(normalizeTrackedPath(file))));
}

function evidenceFromFinding(finding: Finding): EvidenceFact[] {
  const facts: EvidenceFact[] = [];
  const signals = finding.evidence.signals ?? [];
  for (const signal of signals) {
    const contradicting =
      /framework|route|convention|side.?effect|dynamic|string_ref|glob_ref|generated/i.test(
        signal
      );
    facts.push({
      kind: contradicting ? "contradicting" : "supporting",
      source: finding.source,
      detail: signal,
    });
  }
  if (finding.evidence.summary) {
    facts.push({
      kind: "neutral",
      source: finding.source,
      detail: finding.evidence.summary,
    });
  }
  return facts;
}

function buildEvidenceLanguage(input: {
  paths: string[];
  action: RequestedAction;
  related: Finding[];
  status: PlanAnalysisStatus;
  indicators: ReturnType<typeof pathIndicators>;
}): string {
  const pathLabel = input.paths.join(", ");
  const related = input.related[0];
  if (input.indicators.generated) {
    return `“${pathLabel}” appears generated. RepoDiet will not apply a blind edit; change it through its source generator or provide an explicit regenerate plan.`;
  }
  if (input.indicators.protected && input.action.actionType === "DELETE") {
    return `“${pathLabel}” matches a runtime/config or framework-protected pattern. Automatic deletion is blocked until deeper reference and deployment analysis confirms it is inactive.`;
  }
  if (related) {
    const inboundZero = (related.evidence.signals ?? []).some((s) =>
      /inbound(_refs|Refs|Imports)?=0/i.test(s)
    );
    const actionable = (related.evidence.signals ?? []).includes(
      "classification=actionable_candidate"
    );
    if (actionable && inboundZero && isCleanupEligible(related)) {
      return `${related.source} found no static imports for “${pathLabel}”, repository evidence includes inbound references = 0, and preflight classification is actionable_candidate. RepoDiet can plan a bounded ${input.action.actionType.toLowerCase()} with validation before payment.`;
    }
    if (related.action === "review_first") {
      return `${related.source} raised a signal for “${pathLabel}”, but contradicting or incomplete evidence remains. Additional verification is required before RepoDiet can safely apply this request.`;
    }
  }
  if (input.status === "TRANSFORMER_UNAVAILABLE") {
    return `RepoDiet understood the request for “${pathLabel}”, but no supported automatic transformer is available yet. The next step is analysis/planning, not silent skip.`;
  }
  if (input.status === "DEEPER_VERIFICATION_REQUIRED") {
    return `Additional verification is required before RepoDiet can safely apply this request on “${pathLabel}”.`;
  }
  if (input.status === "PLAN_READY") {
    return `RepoDiet found sufficient evidence for this transformation on “${pathLabel}”.`;
  }
  return `RepoDiet recorded the requested ${input.action.actionType} for “${pathLabel}”.`;
}

function resolveStatus(input: {
  action: RequestedAction;
  paths: string[];
  related: Finding[];
  indicators: ReturnType<typeof pathIndicators>;
  transformerAvailable: boolean;
  hasPatch: boolean;
}): { status: PlanAnalysisStatus; executable: boolean; blocker?: string; nextStep?: string } {
  if (input.paths.length === 0) {
    return {
      status: "INVALID_AT_PINNED_COMMIT",
      executable: false,
      blocker: "No tracked paths were supplied for this request.",
      nextStep: "Select a tracked repository path, then choose an action.",
    };
  }

  if (input.action.actionType === "INSPECT" || input.action.actionType === "KEEP" || input.action.actionType === "SUPPRESS") {
    return {
      status: "PLAN_READY",
      executable: false,
      nextStep: "No repository write is planned for this action.",
    };
  }

  if (input.indicators.generated && input.action.actionType !== "REGENERATE") {
    return {
      status: "PROTECTED_BY_POLICY",
      executable: false,
      blocker: "Generated file should be changed through its source generator.",
      nextStep: "Request REGENERATE, or edit the generator source instead.",
    };
  }

  if (
    input.indicators.protected &&
    (input.action.actionType === "DELETE" || input.action.actionType === "EDIT")
  ) {
    const eligible = input.related.some(isCleanupEligible);
    if (!eligible) {
      return {
        status: "DEEPER_VERIFICATION_REQUIRED",
        executable: false,
        blocker:
          "Runtime/config or framework-protected path requires deeper verification before automatic changes.",
        nextStep: "Run deeper verification or provide an explicit custom plan with validation.",
      };
    }
  }

  if (!input.transformerAvailable && input.action.actionType !== "CUSTOM") {
    return {
      status: "TRANSFORMER_UNAVAILABLE",
      executable: false,
      blocker: "No supported automatic transformer is registered for this action yet.",
      nextStep: "RepoDiet will keep this as a planning request; choose Inspect or Custom cleanup.",
    };
  }

  if (input.action.actionType === "CUSTOM" && !input.action.userInstruction?.trim()) {
    return {
      status: "USER_DECISION_REQUIRED",
      executable: false,
      blocker: "Custom cleanup requires a user instruction.",
      nextStep: "Describe the intended edit, then re-analyze the selected scope.",
    };
  }

  if (input.action.actionType === "CONSOLIDATE_DUPLICATES" && !input.action.canonicalPath) {
    return {
      status: "USER_DECISION_REQUIRED",
      executable: false,
      blocker: "Duplicate consolidation requires a chosen canonical file.",
      nextStep: "Choose the RepoDiet-recommended canonical or another member file.",
    };
  }

  // Executable only when we have a real patch from preflight.
  if (!input.hasPatch) {
    return {
      status: "DEEPER_VERIFICATION_REQUIRED",
      executable: false,
      blocker: "No isolated preflight patch has been produced yet.",
      nextStep: "Analyze selected scope to generate an exact patch preview before quoting.",
    };
  }

  return {
    status: "PLAN_READY",
    executable: true,
    nextStep: "Review the exact patch, validation plan, and dynamic quote before payment.",
  };
}

export function analyzeRequestedAction(input: AnalyzeRequestedActionInput): TransformationPlan {
  const paths = input.action.pathIds.map(pathFromId).map(normalizeTrackedPath);
  const primary = paths[0] ?? "";
  const indicators = pathIndicators(primary);
  const related = findingsForPaths(input.findings, paths);
  const transformerAvailable =
    input.transformerAvailable ??
    (input.action.actionType === "DELETE" && related.some(isCleanupEligible));
  const hasPatch = Boolean(input.unifiedDiff && input.unifiedDiff.trim().length > 0);
  const resolved = resolveStatus({
    action: input.action,
    paths,
    related,
    indicators,
    transformerAvailable,
    hasPatch,
  });

  const evidence: EvidenceFact[] = [
    ...related.flatMap(evidenceFromFinding),
    {
      kind: indicators.protected ? "contradicting" : "neutral",
      source: "path_policy",
      detail: indicators.indicators.length
        ? `Path indicators: ${indicators.indicators.join(", ")}`
        : "No generated/vendor/protected indicators on path.",
    },
  ];

  const fileChanges =
    resolved.executable && input.action.actionType === "DELETE"
      ? paths.map((path) => ({
          path,
          action: "delete" as const,
        }))
      : resolved.executable && input.unifiedDiff
        ? paths.map((path) => ({
            path,
            action: "edit" as const,
          }))
        : [];

  const normalizedPatchHash = hasPatch
    ? hashNormalizedPatch(input.unifiedDiff!)
    : undefined;

  const createdAt = new Date().toISOString();
  const draft: Omit<TransformationPlan, "planHash"> = {
    planId: `plan_${nanoid(12)}`,
    repository: input.action.repository,
    pinnedCommit: input.action.pinnedCommit,
    selectedRepositoryPaths: paths,
    selectedFindingIds: [...input.action.findingIds],
    requestedActions: [input.action],
    status: resolved.status,
    executable: resolved.executable,
    summary: buildEvidenceLanguage({
      paths,
      action: input.action,
      related,
      status: resolved.status,
      indicators,
    }),
    evidence,
    proposedAction: input.action.actionType,
    transformerId: input.transformerId,
    transformerAvailable,
    validationCommands: input.validationCommands ?? ["npm run typecheck", "npm run build"],
    unexpectedChangeBudget: 0,
    rollbackPlan: "Discard the isolated branch; no changes are merged automatically.",
    fileChanges,
    unifiedDiff: input.unifiedDiff,
    normalizedPatchHash,
    blockerReason: resolved.blocker,
    nextStep: resolved.nextStep,
    riskTier: indicators.protected
      ? "protected"
      : resolved.executable
        ? "low"
        : indicators.generated
          ? "high"
          : "medium",
    createdAt,
  };

  return {
    ...draft,
    planHash: hashTransformationPlan(draft),
  };
}

/** Selection never implies eligibility. */
export function partitionPlans(plans: TransformationPlan[]): {
  cleanupEligiblePlans: string[];
  blockedPlans: string[];
} {
  return {
    cleanupEligiblePlans: plans.filter((p) => p.executable && p.status === "PLAN_READY").map((p) => p.planId),
    blockedPlans: plans.filter((p) => !p.executable || p.status !== "PLAN_READY").map((p) => p.planId),
  };
}
