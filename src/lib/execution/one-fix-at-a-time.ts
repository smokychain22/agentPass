import path from "node:path";
import type { Finding } from "@/lib/findings/types";
import type { ClassifiedItem } from "@/lib/patch-kit/types";
import { generateUnifiedDeletePatch } from "@/lib/patch-kit/generate-unified-diff";
import { validateCleanupPatchInWorkspace } from "@/lib/patch-kit/validate-patch";
import type { VerifyCheckResult } from "@/lib/jobs/types";
import { isAutoFixEligible, isProtectedFinding } from "@/lib/cleanup/eligibility";
import { resolveFixPlugin, isSupportedFixPlugin } from "./fix-plugins";
import {
  compareBaselineToAfter,
  runBaselineChecks,
  type BaselineCheck,
  type BaselineVerificationReport,
} from "./baseline-verification";

export interface FixAttemptResult {
  finding: Finding;
  status: "verified" | "skipped" | "rejected";
  reason: string;
  pluginId: string;
  unifiedDiff: string;
  deletedPaths: string[];
  patchValidation?: { status: string; error?: string };
  baselineReport?: BaselineVerificationReport;
  checks: VerifyCheckResult[];
}

export interface OneFixLoopResult {
  attempts: FixAttemptResult[];
  retained: FixAttemptResult[];
  unifiedDiff: string;
  deletedPaths: string[];
  metrics: {
    selected: number;
    verified: number;
    skipped: number;
    rejected: number;
  };
}

function findingToSafeItems(finding: Finding): ClassifiedItem[] {
  return finding.files.map((file) => ({
    path: file,
    reason: finding.reason,
    findingId: finding.id,
    findingType: finding.type,
  }));
}

function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")) continue;
    if (line.startsWith("+")) added += 1;
    if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

function mergeDiffs(diffs: string[]): string {
  return diffs.filter(Boolean).join("\n");
}

export async function runOneFixAtATimeLoop(
  rootDir: string,
  findings: Finding[],
  options?: { maxFixes?: number }
): Promise<OneFixLoopResult> {
  const maxFixes = options?.maxFixes ?? 1;
  const candidates = findings
    .filter(isAutoFixEligible)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxFixes);

  const attempts: FixAttemptResult[] = [];
  const retainedDiffs: string[] = [];
  const allDeleted: string[] = [];

  for (const finding of candidates) {
    const plugin = resolveFixPlugin(finding);
    if (!isSupportedFixPlugin(plugin)) {
      attempts.push({
        finding,
        status: "rejected",
        reason: `Unsupported fix type: ${plugin.label}`,
        pluginId: plugin.id,
        unifiedDiff: "",
        deletedPaths: [],
        checks: [],
      });
      continue;
    }

    if (isProtectedFinding(finding)) {
      attempts.push({
        finding,
        status: "rejected",
        reason: "Protected route, config, or framework file.",
        pluginId: plugin.id,
        unifiedDiff: "",
        deletedPaths: [],
        checks: [],
      });
      continue;
    }

    const safeItems = findingToSafeItems(finding);
    if (safeItems.length === 0) {
      attempts.push({
        finding,
        status: "skipped",
        reason: "No file paths associated with finding.",
        pluginId: plugin.id,
        unifiedDiff: "",
        deletedPaths: [],
        checks: [],
      });
      continue;
    }

    try {
      const baseline = await runBaselineChecks(rootDir);
      const { patch: unifiedDiff, deletedPaths } = await generateUnifiedDeletePatch(
        rootDir,
        safeItems
      );

      if (deletedPaths.length === 0) {
        attempts.push({
          finding,
          status: "skipped",
          reason: "No safe file deletions generated.",
          pluginId: plugin.id,
          unifiedDiff: "",
          deletedPaths: [],
          checks: [],
        });
        continue;
      }

      const patchValidation = await validateCleanupPatchInWorkspace(rootDir, unifiedDiff);
      const checks: VerifyCheckResult[] = [
        {
          name: "Patch validation",
          command: "git apply --check",
          status:
            patchValidation.status === "passed"
              ? "passed"
              : patchValidation.status === "skipped"
                ? "skipped"
                : "failed",
          exitCode: patchValidation.status === "passed" ? 0 : 1,
          durationMs: 0,
          stdoutSummary: patchValidation.status === "passed" ? "Patch applies cleanly." : "",
          stderrSummary: patchValidation.error ?? "",
        },
        {
          name: "Protected files",
          command: "policy check",
          status: "passed",
          exitCode: 0,
          durationMs: 0,
          stdoutSummary: "Protected paths unchanged.",
          stderrSummary: "",
        },
      ];

      if (patchValidation.status !== "passed") {
        attempts.push({
          finding,
          status: "skipped",
          reason: patchValidation.error ?? "Patch validation failed.",
          pluginId: plugin.id,
          unifiedDiff,
          deletedPaths,
          patchValidation,
          checks,
        });
        continue;
      }

      const patchFile = path.join(rootDir, ".repodiet-single.patch");
      const { execa } = await import("execa");
      const fs = await import("node:fs/promises");
      await fs.writeFile(patchFile, unifiedDiff, "utf8");
      await execa("git", ["apply", patchFile], { cwd: rootDir, reject: false });

      const afterBaseline = await runBaselineChecks(rootDir);
      const compared = compareBaselineToAfter(baseline, afterBaseline);
      const introduced = compared.filter((c) => c.outcome === "introduced_failure");

      const baselineReport: BaselineVerificationReport = {
        baseline,
        after: afterBaseline,
        compared,
        summary: {
          introducedFailures: introduced.length,
          preExistingFailures: compared.filter((c) => c.outcome === "pre_existing_failure").length,
          passed: compared.filter((c) => c.outcome === "passed").length,
          unavailable: compared.filter((c) => c.outcome === "unavailable").length,
        },
      };

      for (const c of compared) {
        checks.push({
          name: `${c.name} (after)`,
          command: c.command,
          status: c.status,
          exitCode: c.exitCode,
          durationMs: c.durationMs,
          stdoutSummary: c.stdoutSummary,
          stderrSummary:
            c.outcome === "pre_existing_failure"
              ? `${c.stderrSummary} [pre-existing]`
              : c.stderrSummary,
        });
      }

      if (introduced.length > 0) {
        await execa("git", ["checkout", "--", "."], { cwd: rootDir, reject: false });
        for (const p of deletedPaths) {
          await execa("git", ["checkout", "HEAD", "--", p], { cwd: rootDir, reject: false }).catch(
            () => undefined
          );
        }
        attempts.push({
          finding,
          status: "skipped",
          reason: `Verification introduced failure in: ${introduced.map((c) => c.name).join(", ")}`,
          pluginId: plugin.id,
          unifiedDiff,
          deletedPaths,
          patchValidation,
          baselineReport,
          checks,
        });
        continue;
      }

      retainedDiffs.push(unifiedDiff);
      allDeleted.push(...deletedPaths);
      attempts.push({
        finding,
        status: "verified",
        reason: "Fix verified and retained.",
        pluginId: plugin.id,
        unifiedDiff,
        deletedPaths,
        patchValidation,
        baselineReport,
        checks,
      });
    } catch (err) {
      attempts.push({
        finding,
        status: "skipped",
        reason: err instanceof Error ? err.message : "Fix attempt failed.",
        pluginId: plugin.id,
        unifiedDiff: "",
        deletedPaths: [],
        checks: [],
      });
    }
  }

  const retained = attempts.filter((a) => a.status === "verified");
  return {
    attempts,
    retained,
    unifiedDiff: mergeDiffs(retainedDiffs),
    deletedPaths: allDeleted,
    metrics: {
      selected: candidates.length,
      verified: retained.length,
      skipped: attempts.filter((a) => a.status === "skipped").length,
      rejected: attempts.filter((a) => a.status === "rejected").length,
    },
  };
}

export { countDiffLines };
