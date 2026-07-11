import type { Finding, FindingType } from "@/lib/findings/types";
import type { RepositoryModel } from "@/lib/repository-model/types";
import { isActionableFinding } from "@/lib/findings/actionability-signals";
import { resolvePhase1Plugin } from "@/lib/execution/fix-plugins/phase1-plugins";
import { extractAnalyzerEvidence } from "./analyzer-evidence";
import { searchCounterEvidence } from "./counter-evidence";
import { decideClassification } from "./decision-matrix";
import { buildDeletionProof } from "./deletion-proof";
import type { ClassificationDecision, EvidenceBundle } from "./types";

function partitionEvidence(items: ReturnType<typeof extractAnalyzerEvidence>) {
  return {
    analyzerEvidence: items.filter((i) => i.channel === "analyzer"),
    graphEvidence: items.filter((i) => i.channel === "graph"),
    frameworkEvidence: [] as EvidenceBundle["frameworkEvidence"],
    configurationEvidence: [] as EvidenceBundle["configurationEvidence"],
    scriptEvidence: [] as EvidenceBundle["scriptEvidence"],
    runtimeEvidence: [] as EvidenceBundle["runtimeEvidence"],
    gitEvidence: [] as EvidenceBundle["gitEvidence"],
  };
}

export async function classifyFinding(input: {
  finding: Finding;
  rootDir: string;
  repositoryModel?: RepositoryModel;
  commitSha?: string;
}): Promise<ClassificationDecision> {
  const analyzerItems = extractAnalyzerEvidence(input.finding);
  const partitioned = partitionEvidence(analyzerItems);

  const { items: counterItems, channels } = await searchCounterEvidence({
    finding: input.finding,
    rootDir: input.rootDir,
    repositoryModel: input.repositoryModel,
  });

  const frameworkFromCounter = counterItems.filter((i) => i.channel === "framework");
  const configFromCounter = counterItems.filter((i) => i.channel === "configuration");
  const scriptFromCounter = counterItems.filter((i) => i.channel === "script");
  const pureCounter = counterItems.filter(
    (i) => !["framework", "configuration", "script"].includes(i.channel)
  );

  const unresolvedRisks: string[] = [...channels.incomplete];
  if (pureCounter.some((i) => i.strength === "contradicting")) {
    unresolvedRisks.push("counter_evidence_present");
  }

  const decision = decideClassification({
    finding: input.finding,
    counterEvidence: counterItems,
    channels,
    hasPreflightActionable: input.finding.evidence.signals.some(
      (s) => s === "preflight=actionable_candidate" || s === "classification=actionable_candidate"
    ),
    transformerAvailable: resolvePhase1Plugin(input.finding).id !== "review_only",
    actionable: isActionableFinding(input.finding),
  });

  const evidence: EvidenceBundle = {
    ...partitioned,
    frameworkEvidence: [...partitioned.frameworkEvidence, ...frameworkFromCounter],
    configurationEvidence: configFromCounter,
    scriptEvidence: scriptFromCounter,
    counterEvidence: pureCounter,
    unresolvedRisks,
    grade: decision.grade,
    classificationState: decision.classificationState,
    classificationLabel: decision.classificationLabel,
    decisionReason: decision.decisionReason,
    autoFixAllowed: decision.autoFixAllowed,
  };

  let deletionProof;
  if (
    input.finding.type === "unused_file" &&
    input.finding.files[0] &&
    (decision.classificationLabel === "eligible_for_removal" ||
      decision.classificationLabel === "confirmed_unused" ||
      decision.classificationLabel === "backup_archive_candidate")
  ) {
    deletionProof = buildDeletionProof({
      finding: input.finding,
      evidence,
      channels,
      commitSha: input.commitSha,
      approved: decision.autoFixAllowed,
    });
  }

  return {
    ...decision,
    evidence,
    deletionProof,
  };
}

export async function classifyFindingsBatch(input: {
  findings: Finding[];
  rootDir: string;
  repositoryModel?: RepositoryModel;
  commitSha?: string;
}): Promise<Map<string, ClassificationDecision>> {
  const out = new Map<string, ClassificationDecision>();
  for (const finding of input.findings) {
    out.set(finding.id, await classifyFinding({ ...input, finding }));
  }
  return out;
}

export function classificationLabelForType(
  type: FindingType,
  grade: ClassificationDecision["grade"],
  hasCounter: boolean
): ClassificationDecision["classificationLabel"] {
  if (hasCounter) return "review_required";
  switch (type) {
    case "unused_file":
      return grade === "strong" ? "confirmed_unused" : "potentially_unreferenced";
    case "orphan_pattern":
      return "potential_orphan";
    case "duplicate_code":
      return "exact_duplicate";
    case "unused_import":
      return "unused_import_confirmed";
    case "unused_dependency":
      return "unused_dependency_suspected";
    default:
      return "review_required";
  }
}
