import type { Finding } from "@/lib/findings/types";
import type { DeletionProof, EvidenceBundle, ReferenceChannelStatus } from "./types";
import { CATEGORY_VERIFICATION } from "./types";

export function buildDeletionProof(input: {
  finding: Finding;
  evidence: EvidenceBundle;
  channels: ReferenceChannelStatus;
  commitSha?: string;
  approved: boolean;
}): DeletionProof {
  const rel = input.finding.files[0] ?? "";
  const analyzersAgreeing = [
    input.finding.source,
    ...input.evidence.analyzerEvidence
      .filter((e) => e.strength === "supporting")
      .map((e) => e.source),
  ];

  const entryPointsChecked = input.evidence.frameworkEvidence.map((e) => e.summary);

  return {
    findingId: input.finding.id,
    filePath: rel,
    commitSha: input.commitSha,
    whyBelievedUnnecessary: input.finding.reason,
    analyzersAgreeing: [...new Set(analyzersAgreeing)],
    entryPointsChecked,
    importsChecked: input.channels.staticImports,
    dynamicReferencesChecked: input.channels.dynamicImports,
    configsChecked: input.channels.configuration,
    scriptsChecked: input.channels.scripts,
    packageExportsChecked: input.channels.packageExports,
    frameworkConventionsChecked: input.channels.frameworkEntryPoint,
    protected: input.finding.protected ?? input.evidence.classificationLabel === "protected",
    protectionReason: input.finding.protectionReason,
    behaviorDependency:
      input.evidence.counterEvidence
        .filter((c) => c.strength === "contradicting")
        .map((c) => c.summary)
        .join("; ") || undefined,
    verificationRequired: CATEGORY_VERIFICATION[input.finding.type] ?? ["typecheck", "build"],
    evidenceGrade: input.evidence.grade,
    approvedForAutomaticDeletion: input.approved,
  };
}
