import type { Finding, FindingsPayload } from "@/lib/findings/types";

export type EvidenceClassification = "SAFE_CANDIDATE" | "REVIEW_FIRST" | "PROTECTED";

export interface EvidenceStandardFinding {
  findingId: string;
  sourceCommit?: string;
  projectRoot?: string;
  type: string;
  paths: string[];
  classification: EvidenceClassification;
  /** Qualitative confidence only — never a fake percentage in UI copy. */
  confidenceTier: "verified" | "high_confidence" | "needs_review" | "suppressed" | "unspecified";
  evidence: {
    staticReferences: string[];
    dynamicReferences: string[];
    packageScriptReferences: string[];
    configurationReferences: string[];
    routeReferences: string[];
    testReferences: string[];
    publicApiReferences: string[];
    entryPoint: boolean;
    generated: boolean;
    protected: boolean;
    whyBelievedRemovable: string;
    whatCouldMakeRemovalUnsafe: string[];
  };
  proposedOperations: string[];
  requiredVerification: string[];
  reasonsNotToExecute: string[];
}

function mapClassification(finding: Finding): EvidenceClassification {
  if (finding.protected || finding.action === "do_not_touch") return "PROTECTED";
  if (finding.action === "safe_candidate") return "SAFE_CANDIDATE";
  return "REVIEW_FIRST";
}

function signalsOf(finding: Finding, prefix: string): string[] {
  return (finding.evidence?.signals ?? [])
    .filter((s) => s.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((s) => s);
}

function channelSummaries(
  finding: Finding,
  channel: keyof NonNullable<Finding["evidenceBundle"]>
): string[] {
  const bundle = finding.evidenceBundle;
  if (!bundle) return [];
  const items = bundle[channel];
  if (!Array.isArray(items)) return [];
  return items.map((i) => (typeof i === "string" ? i : i.summary));
}

export function toEvidenceStandardFinding(
  finding: Finding,
  sourceCommit?: string,
  projectRoot?: string
): EvidenceStandardFinding {
  const classification = mapClassification(finding);
  const counter = [
    ...channelSummaries(finding, "counterEvidence"),
    ...(finding.evidenceBundle?.unresolvedRisks ?? []),
  ];
  const why =
    finding.deletionProof?.whyBelievedUnnecessary ||
    finding.evidence?.summary ||
    finding.reason ||
    "Evidence summary unavailable.";

  const whatCouldMakeRemovalUnsafe =
    counter.length > 0
      ? counter
      : [
          finding.protectionReason,
          finding.deletionProof?.protectionReason,
          finding.deletionProof?.behaviorDependency,
          "Dynamic imports, path aliases, or configuration references may still exist.",
        ].filter((v): v is string => Boolean(v));

  return {
    findingId: finding.id,
    sourceCommit,
    projectRoot: finding.projectRoot || projectRoot,
    type: finding.type.toUpperCase(),
    paths: finding.files,
    classification,
    confidenceTier: finding.confidenceTier ?? "unspecified",
    evidence: {
      staticReferences: [
        ...signalsOf(finding, "static"),
        ...channelSummaries(finding, "graphEvidence").filter((s) =>
          /static|import/i.test(s)
        ),
      ],
      dynamicReferences: [
        ...signalsOf(finding, "dynamic"),
        ...(finding.deletionProof?.dynamicReferencesChecked === false
          ? ["dynamic_references_not_fully_checked"]
          : []),
      ],
      packageScriptReferences: [
        ...signalsOf(finding, "script"),
        ...channelSummaries(finding, "scriptEvidence"),
      ],
      configurationReferences: [
        ...signalsOf(finding, "config"),
        ...channelSummaries(finding, "configurationEvidence"),
      ],
      routeReferences: signalsOf(finding, "route"),
      testReferences: signalsOf(finding, "test"),
      publicApiReferences: signalsOf(finding, "export"),
      entryPoint: Boolean(
        finding.deletionProof?.entryPointsChecked?.length ||
          finding.evidence?.signals?.some((s) => /entrypoint|route/i.test(s))
      ),
      generated: Boolean(finding.evidence?.signals?.some((s) => /generated/i.test(s))),
      protected: Boolean(finding.protected || finding.action === "do_not_touch"),
      whyBelievedRemovable: why,
      whatCouldMakeRemovalUnsafe,
    },
    proposedOperations: finding.suggestedAction
      ? [finding.suggestedAction]
      : finding.supportedTransformer
        ? [finding.supportedTransformer]
        : [],
    requiredVerification: finding.deletionProof?.verificationRequired ?? [],
    reasonsNotToExecute: [
      ...(finding.protectionReason ? [finding.protectionReason] : []),
      ...(classification !== "SAFE_CANDIDATE"
        ? ["Automatic execution blocked until owner approval and stronger verification."]
        : []),
    ],
  };
}

export function flattenFindings(payload: FindingsPayload): Finding[] {
  return [
    ...payload.duplicates,
    ...payload.unused.files,
    ...payload.unused.dependencies,
    ...payload.unused.exports,
    ...payload.orphans,
    ...payload.slopSignals,
  ];
}

export function toEvidenceStandardFindings(payload: FindingsPayload): EvidenceStandardFinding[] {
  return flattenFindings(payload).map((f) =>
    toEvidenceStandardFinding(
      f,
      payload.repo.commitSha,
      payload.repositoryModel?.primaryProjectRoot ||
        payload.analysisLineage?.projectRoot ||
        "."
    )
  );
}
