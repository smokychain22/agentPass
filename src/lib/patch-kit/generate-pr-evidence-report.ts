import type { FindingsPayload, Finding } from "@/lib/findings/types";
import type { PatchKitPayload } from "./types";
import type { RemediationPlan } from "./remediation-class";
import { remediationClassLabel } from "./remediation-class";
import type { VerificationGateReport } from "./verification-gates";
import type { ClassifiedBuckets } from "./types";

function flattenFindings(findings: FindingsPayload): Finding[] {
  return [
    ...findings.duplicates,
    ...findings.unused.files,
    ...findings.unused.dependencies,
    ...findings.unused.exports,
    ...findings.orphans,
    ...findings.slopSignals,
  ];
}

export function generatePrEvidenceReport(input: {
  findings: FindingsPayload;
  patchKit: PatchKitPayload;
  remediationPlan: RemediationPlan;
  verificationGates: VerificationGateReport;
  buckets: ClassifiedBuckets;
  changedPaths: string[];
  deletedPaths: string[];
  patchCommitSha?: string;
}): string {
  const { findings, patchKit, remediationPlan, verificationGates, buckets, changedPaths, deletedPaths } =
    input;
  const flat = flattenFindings(findings);
  const appliedFindingIds = new Set(
    (patchKit.changeManifest ?? []).map((e) => e.findingId).filter(Boolean)
  );
  const appliedFindings = flat.filter((f) => appliedFindingIds.has(f.id));

  const lines: string[] = [
    "# RepoDiet PR evidence report",
    "",
    "This document proves what RepoDiet found, why it was verified, what changed, and how verification ran.",
    "It is not a marketing summary — every claim links to inspectable evidence.",
    "",
    "## Repository pins",
    "",
    `- **Scan commit:** \`${findings.repo.commitSha ?? "unknown"}\``,
    `- **Branch:** \`${findings.repo.branch}\``,
    `- **Patch kit run:** \`${patchKit.id}\``,
    `- **Findings scan:** \`${findings.scanId}\``,
    input.patchCommitSha ? `- **Patch commit:** \`${input.patchCommitSha}\`` : "",
    "",
    "## What RepoDiet found (applied to this PR)",
    "",
  ];

  if (appliedFindings.length === 0) {
    lines.push("_No finding-linked changes in this patch — see change manifest._", "");
  } else {
    for (const f of appliedFindings) {
      const rem = [...remediationPlan.green, ...remediationPlan.yellow, ...remediationPlan.red].find(
        (r) => r.findingId === f.id
      );
      lines.push(`### ${f.title}`, "");
      lines.push(`- **Type:** ${f.type}`);
      lines.push(`- **Location:** ${f.files.join(", ") || f.packageName || "—"}`);
      lines.push(`- **Confidence tier:** ${f.confidenceTier ?? "—"}`);
      lines.push(`- **Remediation class:** ${rem ? remediationClassLabel(rem.remediationClass) : "—"}`);
      lines.push(`- **Why verified:** ${f.evidenceBundle?.decisionReason ?? f.reason}`);
      if (f.evidenceGate?.brief.directEvidence.length) {
        lines.push("- **Direct evidence:**");
        for (const e of f.evidenceGate.brief.directEvidence.slice(0, 6)) {
          lines.push(`  - ${e}`);
        }
      }
      if (f.evidenceGate?.brief.falsePositiveRisks.length) {
        lines.push("- **Remaining false-positive risks:**");
        for (const r of f.evidenceGate.brief.falsePositiveRisks.slice(0, 4)) {
          lines.push(`  - ${r}`);
        }
      }
      lines.push("");
    }
  }

  lines.push(
    "## Files changed",
    "",
    "### Edited",
    ...(changedPaths.length ? changedPaths.map((p) => `- \`${p}\``) : ["_None_"]),
    "",
    "### Deleted",
    ...(deletedPaths.length ? deletedPaths.map((p) => `- \`${p}\``) : ["_None_"]),
    ""
  );

  if (patchKit.changeManifest?.length) {
    lines.push("### Why each file changed", "");
    for (const entry of patchKit.changeManifest) {
      lines.push(
        `- \`${entry.filePath}\` — ${entry.operation} via \`${entry.transformationType}\` (finding \`${entry.findingId}\`)`
      );
    }
    lines.push("");
  }

  lines.push("## Remediation classification (all findings)", "");
  lines.push(
    `| Class | Count | Policy |`,
    `|-------|-------|--------|`,
    `| Green | ${remediationPlan.summary.greenCount} | Deterministic AST / structured edit |`,
    `| Yellow | ${remediationPlan.summary.yellowCount} | Draft patch — human review required |`,
    `| Red | ${remediationPlan.summary.redCount} | Recommendation only — no automation |`,
    ""
  );

  lines.push("## Verification gates", "");
  lines.push(
    `**All required gates passed:** ${verificationGates.allRequiredPassed ? "yes" : "no"}`,
    `(${verificationGates.passedCount} passed, ${verificationGates.failedCount} failed, ${verificationGates.skippedCount} skipped/not run)`,
    ""
  );
  for (const gate of verificationGates.gates) {
    const req = gate.requiredForSafePr ? "required" : "optional";
    lines.push(`- [${gate.status}] **${gate.label}** (${req})${gate.detail ? ` — ${gate.detail}` : ""}`);
  }
  lines.push("");

  const checks = patchKit.repositoryVerification?.checks ?? [];
  if (checks.length) {
    lines.push("## Commands executed", "");
    for (const c of checks) {
      lines.push(`- \`${c.name}\`: **${c.status}**${c.durationMs ? ` (${c.durationMs}ms)` : ""}`);
      if (c.stderrSummary && c.status === "failed") {
        lines.push(`  \`\`\`\n${c.stderrSummary.slice(0, 400)}\n  \`\`\``);
      }
    }
    lines.push("");
  }

  lines.push(
    "## Build result",
    "",
    `- Patch validation: **${patchKit.patchValidation?.status ?? "unknown"}**`,
    `- Repository verification: **${patchKit.repositoryVerification?.status ?? "not_run"}**`,
    `- Verified file operations: **${patchKit.summary.verifiedChanges ?? 0}**`,
    "",
    "## Before / after metrics",
    "",
    `- Safe-delete candidates: ${buckets.safeDelete.length}`,
    `- Review-first (not auto-applied): ${buckets.reviewFirst.length}`,
    `- Protected: ${buckets.doNotTouch.length}`,
    `- Patch lines (approx): ${patchKit.summary.patchLines ?? 0}`,
    "",
    "## Remaining risks",
    "",
    ...(findings.scanCoverageWarning ? [`- ${findings.scanCoverageWarning}`] : []),
    "- Dynamic imports and runtime configuration may hide references not visible to static analysis.",
    "- Yellow and Red findings in this run were not auto-merged.",
    "",
    "## Rollback instructions",
    "",
    "1. Close this PR without merging.",
    "2. Delete the `repodiet/cleanup-*` branch.",
    "3. Re-scan the repository at the original commit if findings state may have drifted.",
    "",
    "---",
    "_Generated by RepoDiet Fix & PR evidence engine._",
    ""
  );

  return lines.filter((l) => l !== undefined).join("\n");
}
