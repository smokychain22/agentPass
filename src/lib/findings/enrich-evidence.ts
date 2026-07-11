import type { Finding, FindingsPayload } from "./types";
import type { RepositoryModel } from "@/lib/repository-model/types";
import { classifyFindingsBatch } from "@/lib/evidence/classify-finding";
import type { ClassificationDecision } from "@/lib/evidence/types";

function fusionToEvidenceGrade(
  grade: ClassificationDecision["grade"]
): Finding["evidenceGrade"] {
  if (grade === "contradictory" || grade === "insufficient") return "weak";
  if (grade === "strong" || grade === "moderate" || grade === "weak") return grade;
  return "weak";
}

function appendEvidenceSignals(finding: Finding, decision: ClassificationDecision): Finding {
  const bundle = decision.evidence;
  const signals = [
    ...finding.evidence.signals.filter(
      (s) =>
        !s.startsWith("evidenceGrade=") &&
        !s.startsWith("classificationState=") &&
        !s.startsWith("classificationLabel=") &&
        !s.startsWith("decisionReason=") &&
        !s.startsWith("autoFixAllowed=") &&
        !s.startsWith("counterEvidence=")
    ),
    `evidenceGrade=${bundle.grade}`,
    `classificationState=${bundle.classificationState}`,
    `classificationLabel=${bundle.classificationLabel}`,
    `autoFixAllowed=${bundle.autoFixAllowed}`,
    `decisionReason=${bundle.decisionReason.slice(0, 240)}`,
  ];

  if (bundle.counterEvidence.length > 0) {
    signals.push(`counterEvidence=${bundle.counterEvidence.length}`);
  }
  if (bundle.unresolvedRisks.length > 0) {
    signals.push(`unresolvedRisks=${bundle.unresolvedRisks.join("|")}`);
  }

  return {
    ...finding,
    evidence: {
      summary: bundle.decisionReason,
      signals,
    },
    evidenceGrade: fusionToEvidenceGrade(bundle.grade),
    classificationState: decision.classificationState,
    classificationLabel: decision.classificationLabel,
    protected: bundle.classificationLabel === "protected" || finding.protected,
    protectionReason:
      bundle.classificationLabel === "protected"
        ? bundle.decisionReason
        : finding.protectionReason,
  };
}

function applyDecision(finding: Finding, decision: ClassificationDecision): Finding {
  const enriched = appendEvidenceSignals(finding, decision);

  const action =
    decision.evidence.classificationLabel === "protected"
      ? "do_not_touch"
      : decision.autoFixAllowed
        ? "safe_candidate"
        : decision.action;

  return {
    ...enriched,
    action,
    evidenceBundle: decision.evidence,
    deletionProof: decision.deletionProof,
  };
}

export async function enrichFindingsWithEvidence(input: {
  rootDir: string;
  payload: FindingsPayload;
  repositoryModel?: RepositoryModel;
}): Promise<FindingsPayload> {
  const flat = [
    ...input.payload.duplicates,
    ...input.payload.unused.files,
    ...input.payload.unused.dependencies,
    ...input.payload.unused.exports,
    ...input.payload.orphans,
    ...input.payload.slopSignals,
  ];

  const decisions = await classifyFindingsBatch({
    findings: flat,
    rootDir: input.rootDir,
    repositoryModel: input.repositoryModel,
    commitSha: input.payload.repo.commitSha,
  });

  const remap = (items: Finding[]) =>
    items.map((f) => {
      const d = decisions.get(f.id);
      return d ? applyDecision(f, d) : f;
    });

  const enriched = {
    ...input.payload,
    duplicates: remap(input.payload.duplicates),
    unused: {
      files: remap(input.payload.unused.files),
      dependencies: remap(input.payload.unused.dependencies),
      exports: remap(input.payload.unused.exports),
    },
    orphans: remap(input.payload.orphans),
    slopSignals: remap(input.payload.slopSignals),
  };

  const all = [
    ...enriched.duplicates,
    ...enriched.unused.files,
    ...enriched.unused.dependencies,
    ...enriched.unused.exports,
    ...enriched.orphans,
    ...enriched.slopSignals,
  ];

  enriched.riskBuckets = {
    safeDelete: all.filter((f) => f.action === "safe_candidate").map((f) => f.id),
    reviewFirst: all.filter((f) => f.action === "review_first").map((f) => f.id),
    doNotTouch: all.filter((f) => f.action === "do_not_touch" || f.protected).map((f) => f.id),
  };

  return enriched;
}
