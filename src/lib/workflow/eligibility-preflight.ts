import type { Finding } from "@/lib/findings/types";
import { isActionableFinding } from "@/lib/findings/actionability-signals";
import { runFixPreflight } from "@/lib/execution/fix-preflight";
import { resolvePhase1Plugin } from "@/lib/execution/fix-plugins/phase1-plugins";
import { isDoNotTouchPath } from "@/lib/findings/confidence-path-rules";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";

export type EligibilityClassification = "safe_candidate" | "review_first" | "protected";

export interface EligibilityPreflightResult {
  findingId: string;
  classification: EligibilityClassification;
  autoFixAllowed: boolean;
  evidenceGrade: string;
  reasons: string[];
  proposedOperation?: {
    type: string;
    path: string;
  };
  preflight: {
    realContentChange: boolean;
    protectedPath: boolean;
    verificationAvailable: boolean;
  };
}

function humanReasons(finding: Finding, preflightBlocker?: string): string[] {
  const reasons: string[] = [];
  const grade = finding.evidenceGrade ?? finding.evidence.signals.find((s) => s.startsWith("evidenceGrade="))?.slice(14);
  if (grade === "moderate") reasons.push("Moderate evidence only");
  if (grade === "weak" || grade === "insufficient") reasons.push("Insufficient evidence for automatic change");
  if (finding.evidence.signals.some((s) => s.includes("export"))) reasons.push("Exported symbol present");
  if (finding.evidence.signals.some((s) => s.includes("dynamic"))) {
    reasons.push("Dynamic import cannot be ruled out");
  }
  if (finding.classificationLabel === "protected" || finding.protected) {
    reasons.push("Protected path");
  }
  if (preflightBlocker?.includes("no content change") || preflightBlocker?.includes("Dry-run")) {
    reasons.push("Transformer produced no content change");
  }
  if (preflightBlocker?.includes("verification")) {
    reasons.push("Verification unavailable");
  }
  if (finding.evidence.signals.some((s) => s.startsWith("routeLike=true"))) {
    reasons.push("Route or framework entrypoint");
  }
  return reasons;
}

function classifyFinding(
  finding: Finding,
  preflight: Awaited<ReturnType<typeof runFixPreflight>>
): EligibilityPreflightResult {
  const protectedPath =
    finding.protected ||
    finding.action === "do_not_touch" ||
    finding.files.some((f) => isDoNotTouchPath(f));

  const realContentChange =
    preflight.classification === "actionable_candidate" && preflight.diffGenerated === true;

  let classification: EligibilityClassification = "review_first";
  if (protectedPath) classification = "protected";
  else if (isActionableFinding(finding) && realContentChange) classification = "safe_candidate";

  const plugin = resolvePhase1Plugin(finding);
  const proposedPath = finding.files[0];
  const proposedOperation =
    proposedPath && plugin.id !== "review_only"
      ? {
          type:
            plugin.id === "remove_unused_import"
              ? "edit_file"
              : plugin.id === "remove_unused_dependency"
                ? "edit_manifest"
                : "delete_file",
          path: proposedPath,
        }
      : undefined;

  const autoFixAllowed = classification === "safe_candidate";
  const reasons = humanReasons(finding, preflight.blocker);
  if (!realContentChange && classification !== "protected") {
    if (!reasons.includes("Transformer produced no content change")) {
      reasons.push("Transformer produced no content change");
    }
  }

  return {
    findingId: finding.id,
    classification,
    autoFixAllowed,
    evidenceGrade: finding.evidenceGrade ?? "moderate",
    reasons,
    proposedOperation,
    preflight: {
      realContentChange,
      protectedPath,
      verificationAvailable: preflight.requiredVerificationSupported,
    },
  };
}

export async function runEligibilityPreflight(input: {
  repoUrl: string;
  branch?: string;
  findings: Finding[];
  findingIds?: string[];
}): Promise<EligibilityPreflightResult[]> {
  const ids = input.findingIds?.length
    ? new Set(input.findingIds)
    : null;
  const selected = ids ? input.findings.filter((f) => ids.has(f.id)) : input.findings;

  const workspace = await prepareRepoWorkspace(input.repoUrl, input.branch);
  try {
    const results: EligibilityPreflightResult[] = [];
    for (const finding of selected) {
      const preflight = await runFixPreflight(workspace.rootDir, finding);
      results.push(classifyFinding(finding, preflight));
    }
    return results;
  } finally {
    await workspace.cleanup();
  }
}

export function groupFindingsByEligibility(
  findings: Finding[],
  preflights: EligibilityPreflightResult[]
): {
  ready: Finding[];
  reviewFirst: Finding[];
  protected: Finding[];
} {
  const byId = new Map(preflights.map((p) => [p.findingId, p]));
  const ready: Finding[] = [];
  const reviewFirst: Finding[] = [];
  const protectedFindings: Finding[] = [];

  for (const finding of findings) {
    const pre = byId.get(finding.id);
    if (!pre) {
      reviewFirst.push(finding);
      continue;
    }
    if (pre.classification === "safe_candidate") ready.push(finding);
    else if (pre.classification === "protected") protectedFindings.push(finding);
    else reviewFirst.push(finding);
  }

  return { ready, reviewFirst, protected: protectedFindings };
}
