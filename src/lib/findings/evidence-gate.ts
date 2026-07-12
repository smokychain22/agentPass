import type { Finding, FusionEvidenceGrade } from "@/lib/findings/types";
import type { EvidenceBundle } from "@/lib/evidence/types";
import type { RepositoryIntelligenceManifest } from "@/lib/scanner/intelligence-manifest";

export type FindingConfidenceTier =
  | "verified"
  | "high_confidence"
  | "needs_review"
  | "suppressed";

export interface EvidencePipelineStage {
  name: "detector_evidence" | "context_verification" | "independent_confirmation";
  label: string;
  passed: boolean;
  summary: string;
  details: string[];
}

export interface PriorityFactors {
  confidence: number;
  reachability: number;
  runtimeExposure: number;
  blastRadius: number;
  maintenanceCost: number;
  recurrence: number;
  fixSafety: number;
}

export interface FindingEvidenceGate {
  confidenceTier: FindingConfidenceTier;
  pipelineStages: EvidencePipelineStage[];
  independentSignalCount: number;
  priorityScore: number;
  priorityFactors: PriorityFactors;
  /** Answers for the finding detail panel */
  brief: FindingEvidenceBrief;
}

export interface FindingEvidenceBrief {
  whatDetected: string;
  whereLocated: string;
  whyProblem: string;
  directEvidence: string[];
  contextConsidered: string[];
  falsePositiveRisks: string[];
  confidenceExplanation: string;
  fixImpact: string;
  verificationPlan: string[];
}

function signalValue(signals: string[], prefix: string): string | undefined {
  const hit = signals.find((s) => s.startsWith(`${prefix}=`));
  return hit?.slice(prefix.length + 1);
}

function nativeAnalyzer(finding: Finding): boolean {
  return finding.sourceMode === "native" && !finding.source.endsWith("_fallback");
}

function hasContradiction(bundle?: EvidenceBundle): boolean {
  return (
    bundle?.counterEvidence.some((i) => i.strength === "contradicting") ||
    bundle?.grade === "contradictory" ||
    false
  );
}

function countIndependentSignals(finding: Finding, bundle?: EvidenceBundle): {
  signals: string[];
  count: number;
} {
  const signals: string[] = [];
  const seen = new Set<string>();

  const add = (key: string, label: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    signals.push(label);
  };

  if (nativeAnalyzer(finding)) {
    add("native_analyzer", `${finding.source} native detector`);
  }

  const inbound = signalValue(finding.evidence.signals, "inbound_refs");
  if (inbound === "0") {
    add("graph_zero_inbound", "RepoDiet graph: zero inbound references");
  }

  if (finding.evidence.signals.some((s) => s.startsWith("exact_duplicate=true"))) {
    add("exact_duplicate", "Byte-identical duplicate confirmed");
  }

  if (
    finding.evidence.signals.some(
      (s) => s === "preflight=actionable_candidate" || s === "classification=actionable_candidate"
    )
  ) {
    add("preflight", "Transformer preflight passed");
  }

  if (finding.source.startsWith("repodiet_")) {
    add("repodiet_internal", `RepoDiet internal analyzer (${finding.source})`);
  }

  if (bundle?.graphEvidence.some((i) => i.strength === "supporting")) {
    add("graph_support", "Graph evidence supports finding");
  }

  if (bundle?.frameworkEvidence.length) {
    add("framework_checked", "Framework entry-point rules evaluated");
  }

  if (bundle?.configurationEvidence.length || bundle?.scriptEvidence.length) {
    add("config_script_checked", "Configuration and script references checked");
  }

  if (finding.type === "unused_import" && finding.evidence.signals.some((s) => s.startsWith("symbol="))) {
    add("symbol_resolved", "Unused import symbol resolved in AST");
  }

  return { signals, count: signals.length };
}

function buildDetectorStage(finding: Finding): EvidencePipelineStage {
  const details: string[] = [];
  const native = nativeAnalyzer(finding);

  details.push(`${finding.source} (${finding.sourceMode}) reported: ${finding.reason}`);

  if (finding.analyzerEvidence) {
    details.push(finding.analyzerEvidence);
  }

  for (const sig of finding.evidence.signals.filter(
    (s) =>
      !s.startsWith("evidenceGrade=") &&
      !s.startsWith("classification") &&
      !s.startsWith("decisionReason=") &&
      !s.startsWith("autoFixAllowed=")
  ).slice(0, 6)) {
    details.push(sig);
  }

  const passed = native && finding.sourceMode !== "fallback";

  return {
    name: "detector_evidence",
    label: "Stage 1 — Detector evidence",
    passed,
    summary: passed
      ? `Native ${finding.source} produced structural evidence.`
      : "Detector evidence is fallback or heuristic — not sufficient alone.",
    details,
  };
}

function buildContextStage(finding: Finding, bundle?: EvidenceBundle): EvidencePipelineStage {
  const channels: string[] = [];
  const hits: string[] = [];

  if (bundle?.frameworkEvidence.length) {
    channels.push("framework entry points");
    for (const item of bundle.frameworkEvidence) {
      hits.push(item.summary);
    }
  }
  if (bundle?.configurationEvidence.length) {
    channels.push("configuration references");
    for (const item of bundle.configurationEvidence) {
      hits.push(item.summary);
    }
  }
  if (bundle?.scriptEvidence.length) {
    channels.push("npm scripts");
    for (const item of bundle.scriptEvidence) {
      hits.push(item.summary);
    }
  }
  if (bundle?.runtimeEvidence.length) {
    channels.push("dynamic import patterns");
  }
  if (bundle?.counterEvidence.length) {
    channels.push("counter-evidence search");
  }

  const contradicting = bundle?.counterEvidence.filter((i) => i.strength === "contradicting") ?? [];
  const incomplete = bundle?.unresolvedRisks ?? [];

  const passed =
    contradicting.length === 0 &&
    !incomplete.some((r) => r.includes("counter_evidence_present"));

  const details = [
    ...channels.map((c) => `Checked: ${c}`),
    ...hits.slice(0, 5),
    ...(contradicting.length > 0
      ? contradicting.map((c) => `Counter: ${c.summary}`)
      : ["No contradicting references found in checked channels."]),
    ...(incomplete.length > 0 ? incomplete.map((r) => `Unresolved: ${r}`) : []),
  ];

  return {
    name: "context_verification",
    label: "Stage 2 — Context verification",
    passed,
    summary: passed
      ? "Framework, config, scripts, and dynamic-import channels checked — no contradictions."
      : "Potential hidden references — review before treating as unused or dead.",
    details,
  };
}

function buildConfirmationStage(
  finding: Finding,
  independent: { signals: string[]; count: number },
  grade: FusionEvidenceGrade | undefined
): EvidencePipelineStage {
  const required = finding.type === "unused_file" || finding.type === "orphan_pattern" ? 2 : 1;
  const passed =
    independent.count >= required &&
    grade !== "insufficient" &&
    grade !== "contradictory" &&
    grade !== "weak";

  return {
    name: "independent_confirmation",
    label: "Stage 3 — Independent confirmation",
    passed,
    summary: passed
      ? `${independent.count} independent signal(s) corroborate the finding.`
      : `Only ${independent.count} independent signal(s) — need ${required}+ for Verified tier.`,
    details: independent.signals,
  };
}

function resolveConfidenceTier(input: {
  finding: Finding;
  grade?: FusionEvidenceGrade;
  independentCount: number;
  contextPassed: boolean;
  detectorPassed: boolean;
  confirmationPassed: boolean;
  autoFixAllowed: boolean;
}): FindingConfidenceTier {
  const { finding, grade, independentCount, contextPassed, detectorPassed, confirmationPassed } =
    input;

  if (
    finding.classificationLabel === "protected" ||
    finding.action === "do_not_touch" ||
    finding.protected
  ) {
    return "suppressed";
  }

  if (hasContradiction(finding.evidenceBundle) || grade === "contradictory") {
    return "needs_review";
  }

  if (
    grade === "strong" &&
    detectorPassed &&
    contextPassed &&
    confirmationPassed &&
    independentCount >= 2 &&
    nativeAnalyzer(finding)
  ) {
    return "verified";
  }

  if (
    (grade === "strong" || grade === "moderate") &&
    detectorPassed &&
    contextPassed &&
    independentCount >= 1
  ) {
    return "high_confidence";
  }

  if (grade === "insufficient" || !detectorPassed) {
    return "needs_review";
  }

  return "needs_review";
}

function tierToConfidenceFactor(tier: FindingConfidenceTier): number {
  switch (tier) {
    case "verified":
      return 1;
    case "high_confidence":
      return 0.75;
    case "needs_review":
      return 0.35;
    case "suppressed":
      return 0.05;
  }
}

function computeReachability(finding: Finding): number {
  const inbound = signalValue(finding.evidence.signals, "inbound_refs");
  if (inbound === "0") return 0.95;
  if (inbound !== undefined && Number(inbound) > 0) return 0.4;
  if (finding.type === "orphan_pattern") return 0.85;
  if (finding.type === "unused_dependency") return 0.7;
  return 0.55;
}

function computeRuntimeExposure(finding: Finding): number {
  const path = finding.files[0] ?? "";
  if (/middleware|api\/|route\.(ts|js)|pages\/api/i.test(path)) return 1;
  if (/app\/.*\/page\.(tsx|jsx|ts|js)/i.test(path)) return 0.9;
  if (/\.(tsx|jsx)$/.test(path)) return 0.65;
  if (finding.type === "unused_dependency") return 0.8;
  return 0.45;
}

function computeBlastRadius(finding: Finding): number {
  if (finding.type === "unused_dependency") return 0.85;
  if (finding.type === "duplicate_code" && finding.files.length >= 2) return 0.7;
  if (finding.files.length > 3) return Math.min(1, 0.5 + finding.files.length * 0.1);
  return 0.4;
}

function computeMaintenanceCost(finding: Finding): number {
  if (finding.type === "duplicate_code") {
    const lines = signalValue(finding.evidence.signals, "lines");
    const n = lines ? Number(lines) : 0;
    return Math.min(1, 0.4 + n / 200);
  }
  if (finding.type === "unused_file" || finding.type === "unused_import") return 0.75;
  if (finding.type === "ai_slop_signal") return 0.5;
  return 0.55;
}

function computeRecurrence(finding: Finding): number {
  if (finding.type === "duplicate_code") {
    const sim = signalValue(finding.evidence.signals, "similarity");
    const n = sim ? Number(sim.replace("%", "")) / 100 : 0.5;
    return Math.min(1, 0.5 + n * 0.5);
  }
  return 0.5;
}

function computeFixSafety(finding: Finding, tier: FindingConfidenceTier): number {
  if (finding.evidenceBundle?.autoFixAllowed) return 1;
  if (tier === "verified" && finding.action === "safe_candidate") return 0.9;
  if (finding.action === "safe_candidate") return 0.65;
  if (finding.action === "review_first") return 0.35;
  return 0.1;
}

export function computePriorityScore(
  finding: Finding,
  tier: FindingConfidenceTier
): { score: number; factors: PriorityFactors } {
  const factors: PriorityFactors = {
    confidence: tierToConfidenceFactor(tier),
    reachability: computeReachability(finding),
    runtimeExposure: computeRuntimeExposure(finding),
    blastRadius: computeBlastRadius(finding),
    maintenanceCost: computeMaintenanceCost(finding),
    recurrence: computeRecurrence(finding),
    fixSafety: computeFixSafety(finding, tier),
  };

  const score =
    factors.confidence *
    factors.reachability *
    factors.runtimeExposure *
    factors.blastRadius *
    factors.maintenanceCost *
    factors.recurrence *
    factors.fixSafety;

  return { score: Math.round(score * 1000) / 1000, factors };
}

function buildBrief(
  finding: Finding,
  tier: FindingConfidenceTier,
  pipeline: EvidencePipelineStage[],
  scanIntelligence?: RepositoryIntelligenceManifest
): FindingEvidenceBrief {
  const bundle = finding.evidenceBundle;
  const falsePositiveRisks: string[] = [];

  if (bundle?.unresolvedRisks.length) {
    falsePositiveRisks.push(...bundle.unresolvedRisks);
  }
  if (!nativeAnalyzer(finding)) {
    falsePositiveRisks.push("Finding relies on fallback analyzer, not native tool output.");
  }
  if (finding.type === "unused_file") {
    falsePositiveRisks.push(
      "Dynamic import(), string-based routing, or code generation may reference this file."
    );
  }
  if (finding.type === "unused_dependency") {
    falsePositiveRisks.push("Peer dependency, optional import, or CLI-only usage may exist.");
  }
  if (finding.type === "orphan_pattern") {
    falsePositiveRisks.push("Circular dependency may be intentional lazy-loading pattern.");
  }

  const contextConsidered: string[] = [];
  if (scanIntelligence) {
    contextConsidered.push(
      `Framework: ${scanIntelligence.structure.framework.name}`,
      `Workspaces: ${scanIntelligence.structure.workspaces.length || "none"}`,
      `Entry points detected: ${scanIntelligence.entryPoints.length}`
    );
  }
  for (const stage of pipeline) {
    if (stage.name === "context_verification") {
      contextConsidered.push(...stage.details.filter((d) => d.startsWith("Checked:")));
    }
  }

  const directEvidence = pipeline
    .flatMap((s) => s.details)
    .filter((d) => !d.startsWith("Unresolved:"))
    .slice(0, 12);

  const verificationPlan =
    finding.deletionProof?.verificationRequired ??
    (finding.type === "unused_import"
      ? ["parse", "typecheck"]
      : finding.type === "unused_file"
        ? ["import_graph", "typecheck", "build"]
        : finding.type === "duplicate_code"
          ? ["typecheck", "build"]
          : ["review"]);

  let fixImpact = "No automatic change recommended.";
  if (tier === "verified" && finding.evidenceBundle?.autoFixAllowed) {
    fixImpact = "Low-risk deterministic fix — eligible for automatic cleanup PR with verification.";
  } else if (tier === "high_confidence") {
    fixImpact = "Patch may be generated as a draft — human review required before merge.";
  } else if (finding.action === "safe_candidate") {
    fixImpact = "Change is structurally plausible but evidence is not fully verified.";
  }

  const tierExplanation: Record<FindingConfidenceTier, string> = {
    verified: "Deterministically proven with complete structural evidence from multiple independent signals.",
    high_confidence:
      "Strong evidence with one imperfect framework or runtime assumption — draft fixes only.",
    needs_review: "Potential issue without enough cross-tool evidence for automatic action.",
    suppressed: "Intentional or protected behavior — excluded from automatic cleanup.",
  };

  return {
    whatDetected: finding.title,
    whereLocated:
      finding.files.length > 0
        ? finding.files.join(", ")
        : (finding.packageName ?? finding.manifestPath ?? "—"),
    whyProblem: finding.reason,
    directEvidence,
    contextConsidered,
    falsePositiveRisks,
    confidenceExplanation: tierExplanation[tier],
    fixImpact,
    verificationPlan,
  };
}

export function runEvidenceGate(
  finding: Finding,
  scanIntelligence?: RepositoryIntelligenceManifest
): FindingEvidenceGate {
  const bundle = finding.evidenceBundle;
  const grade = bundle?.grade ?? finding.evidenceGrade;

  const detectorStage = buildDetectorStage(finding);
  const contextStage = buildContextStage(finding, bundle);
  const independent = countIndependentSignals(finding, bundle);
  const confirmationStage = buildConfirmationStage(finding, independent, grade);

  const pipelineStages = [detectorStage, contextStage, confirmationStage];

  const confidenceTier = resolveConfidenceTier({
    finding,
    grade,
    independentCount: independent.count,
    contextPassed: contextStage.passed,
    detectorPassed: detectorStage.passed,
    confirmationPassed: confirmationStage.passed,
    autoFixAllowed: bundle?.autoFixAllowed ?? false,
  });

  const { score, factors } = computePriorityScore(finding, confidenceTier);
  const brief = buildBrief(finding, confidenceTier, pipelineStages, scanIntelligence);

  return {
    confidenceTier,
    pipelineStages,
    independentSignalCount: independent.count,
    priorityScore: score,
    priorityFactors: factors,
    brief,
  };
}

export function confidenceTierLabel(tier: FindingConfidenceTier): string {
  switch (tier) {
    case "verified":
      return "Verified";
    case "high_confidence":
      return "High confidence";
    case "needs_review":
      return "Needs review";
    case "suppressed":
      return "Suppressed";
  }
}

export function sortFindingsByPriority(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const pa = a.evidenceGate?.priorityScore ?? 0;
    const pb = b.evidenceGate?.priorityScore ?? 0;
    if (pb !== pa) return pb - pa;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
}
