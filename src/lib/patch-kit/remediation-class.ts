import type { Finding, FindingType } from "@/lib/findings/types";
import type { Phase1PluginId } from "@/lib/execution/fix-plugins/phase1-plugins";
import { resolvePhase1Plugin } from "@/lib/execution/fix-plugins/phase1-plugins";

export type RemediationClass = "green" | "yellow" | "red";

export interface RemediationClassification {
  findingId: string;
  findingType: FindingType;
  remediationClass: RemediationClass;
  autoFixAllowed: boolean;
  pluginId: Phase1PluginId;
  reason: string;
  verificationRequired: string[];
  draftPatchOnly: boolean;
}

export interface RemediationPlan {
  green: RemediationClassification[];
  yellow: RemediationClassification[];
  red: RemediationClassification[];
  summary: {
    greenCount: number;
    yellowCount: number;
    redCount: number;
    autoFixEligibleCount: number;
  };
}

const RED_PATH_PATTERNS: RegExp[] = [
  /(^|\/)(auth|authentication|authorize|authorization)(\/|$)/i,
  /(^|\/)payment/i,
  /(^|\/)billing/i,
  /(^|\/)migrate/i,
  /(^|\/)migrations?(\/|$)/i,
  /(^|\/)database(\/|$)/i,
  /(^|\/)prisma(\/|$)/i,
  /(^|\/)middleware\.(ts|js)$/i,
  /(^|\/)env\./i,
  /(^|\/)public\/api/i,
];

const YELLOW_TYPES = new Set<FindingType>(["duplicate_code", "orphan_pattern"]);

function pathMatchesRedZone(files: string[]): boolean {
  return files.some((f) => RED_PATH_PATTERNS.some((p) => p.test(f.replace(/\\/g, "/"))));
}

function nativeAnalyzer(finding: Finding): boolean {
  return finding.sourceMode === "native" && !finding.source.endsWith("_fallback");
}

function isExactDuplicate(finding: Finding): boolean {
  return finding.evidence.signals.some(
    (s) => s.startsWith("exact_duplicate=true") || s.startsWith("exact_file_duplicate=true")
  );
}

function isProvenUnreachableFile(finding: Finding): boolean {
  const inbound = finding.evidence.signals.find((s) => s.startsWith("inbound_refs="));
  return inbound?.endsWith("=0") ?? false;
}

export function classifyFindingRemediation(finding: Finding): RemediationClassification {
  const plugin = resolvePhase1Plugin(finding);
  const tier =
    finding.confidenceTier ??
    (finding.evidenceBundle?.autoFixAllowed
      ? "verified"
      : finding.action === "safe_candidate"
        ? "high_confidence"
        : "needs_review");
  const bundle = finding.evidenceBundle;
  const verificationRequired =
    finding.deletionProof?.verificationRequired ??
    (finding.type === "unused_import"
      ? ["parse", "typecheck"]
      : finding.type === "unused_file"
        ? ["import_graph", "typecheck", "build"]
        : finding.type === "unused_dependency"
          ? ["clean_install", "typecheck", "build"]
          : ["review"]);

  if (
    finding.action === "do_not_touch" ||
    finding.protected ||
    finding.classificationLabel === "protected" ||
    tier === "suppressed"
  ) {
    return {
      findingId: finding.id,
      findingType: finding.type,
      remediationClass: "red",
      autoFixAllowed: false,
      pluginId: plugin.id,
      reason: finding.protectionReason ?? "Protected path or intentional behavior — recommendation only.",
      verificationRequired,
      draftPatchOnly: false,
    };
  }

  if (pathMatchesRedZone(finding.files)) {
    return {
      findingId: finding.id,
      findingType: finding.type,
      remediationClass: "red",
      autoFixAllowed: false,
      pluginId: plugin.id,
      reason: "Touches authentication, payment, migration, or public API surface — not safe to automate.",
      verificationRequired,
      draftPatchOnly: false,
    };
  }

  if (tier === "needs_review" || bundle?.grade === "contradictory" || bundle?.grade === "insufficient") {
    return {
      findingId: finding.id,
      findingType: finding.type,
      remediationClass: "red",
      autoFixAllowed: false,
      pluginId: plugin.id,
      reason: bundle?.decisionReason ?? "Insufficient evidence for automated remediation.",
      verificationRequired,
      draftPatchOnly: false,
    };
  }

  if (finding.type === "unused_import" && (tier === "verified" || bundle?.autoFixAllowed)) {
    return {
      findingId: finding.id,
      findingType: finding.type,
      remediationClass: "green",
      autoFixAllowed: true,
      pluginId: plugin.id,
      reason: "AST-proven unused import with preflight — deterministic removal.",
      verificationRequired,
      draftPatchOnly: false,
    };
  }

  if (
    finding.type === "unused_dependency" &&
    tier === "verified" &&
    nativeAnalyzer(finding) &&
    bundle?.grade === "strong"
  ) {
    return {
      findingId: finding.id,
      findingType: finding.type,
      remediationClass: "green",
      autoFixAllowed: true,
      pluginId: plugin.id,
      reason: "Exactly proven unused dependency with native Knip evidence.",
      verificationRequired,
      draftPatchOnly: false,
    };
  }

  if (
    finding.type === "unused_file" &&
    (isProvenUnreachableFile(finding) || finding.evidence.signals.some((s) => s.startsWith("empty_file=true"))) &&
    (tier === "verified" || tier === "high_confidence") &&
    nativeAnalyzer(finding)
  ) {
    const isTemp = /\.(backup|old|copy|unused)\./i.test(finding.files[0] ?? "");
    return {
      findingId: finding.id,
      findingType: finding.type,
      remediationClass: isTemp || tier === "verified" ? "green" : "yellow",
      autoFixAllowed: isTemp || tier === "verified",
      pluginId: plugin.id,
      reason: isTemp
        ? "Archive/backup/temp file with zero inbound references."
        : "Unreachable file — draft delete requires stronger verification.",
      verificationRequired,
      draftPatchOnly: !isTemp && tier !== "verified",
    };
  }

  if (finding.type === "unused_export" && tier === "verified" && nativeAnalyzer(finding)) {
    return {
      findingId: finding.id,
      findingType: finding.type,
      remediationClass: "green",
      autoFixAllowed: true,
      pluginId: plugin.id,
      reason: "Private unused export — structured removal.",
      verificationRequired,
      draftPatchOnly: false,
    };
  }

  if (finding.type === "duplicate_code" && isExactDuplicate(finding) && nativeAnalyzer(finding)) {
    return {
      findingId: finding.id,
      findingType: finding.type,
      remediationClass: "green",
      autoFixAllowed: false,
      pluginId: plugin.id,
      reason: "Exact duplicated declaration — document for manual dedup; auto-merge not enabled.",
      verificationRequired: ["reference_update", "typecheck", "build"],
      draftPatchOnly: true,
    };
  }

  if (YELLOW_TYPES.has(finding.type) || tier === "high_confidence") {
    return {
      findingId: finding.id,
      findingType: finding.type,
      remediationClass: "yellow",
      autoFixAllowed: false,
      pluginId: plugin.id,
      reason:
        finding.type === "duplicate_code"
          ? "Duplicate consolidation requires human review and stronger testing."
          : finding.type === "orphan_pattern"
            ? "Circular dependency break may change runtime load order — draft patch only."
            : "Strong but imperfect evidence — generate draft patch, not auto-merge.",
      verificationRequired,
      draftPatchOnly: true,
    };
  }

  if (finding.type === "ai_slop_signal" && finding.action === "safe_candidate") {
    return {
      findingId: finding.id,
      findingType: finding.type,
      remediationClass: "green",
      autoFixAllowed: true,
      pluginId: plugin.id,
      reason: "Stale backup/slop artifact matching safe-delete patterns.",
      verificationRequired: ["review"],
      draftPatchOnly: false,
    };
  }

  return {
    findingId: finding.id,
    findingType: finding.type,
    remediationClass: "red",
    autoFixAllowed: false,
    pluginId: plugin.id,
    reason: "Does not meet deterministic autofix criteria — explain remediation only.",
    verificationRequired,
    draftPatchOnly: false,
  };
}

export function buildRemediationPlan(findings: Finding[]): RemediationPlan {
  const green: RemediationClassification[] = [];
  const yellow: RemediationClassification[] = [];
  const red: RemediationClassification[] = [];

  for (const finding of findings) {
    const item = classifyFindingRemediation(finding);
    if (item.remediationClass === "green") green.push(item);
    else if (item.remediationClass === "yellow") yellow.push(item);
    else red.push(item);
  }

  return {
    green,
    yellow,
    red,
    summary: {
      greenCount: green.length,
      yellowCount: yellow.length,
      redCount: red.length,
      autoFixEligibleCount: green.filter((g) => g.autoFixAllowed).length,
    },
  };
}

export function remediationClassLabel(cls: RemediationClass): string {
  switch (cls) {
    case "green":
      return "Green — deterministic autofix";
    case "yellow":
      return "Yellow — draft patch";
    case "red":
      return "Red — recommendation only";
  }
}

export function isGreenAutoFixAllowed(findingId: string, plan: RemediationPlan): boolean {
  return plan.green.some((g) => g.findingId === findingId && g.autoFixAllowed);
}
