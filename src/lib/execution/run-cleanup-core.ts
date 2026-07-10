import { nanoid } from "nanoid";
import type { Finding, FindingsPayload } from "@/lib/findings/types";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import {
  FREE_CLEANUP_LIMIT,
  isAutoFixEligible,
  listAutoFixEligible,
  listReviewPlanEligible,
} from "@/lib/cleanup/eligibility";
import { classifyFindingsForPatch } from "@/lib/patch-kit/safe-delete-classifier";
import {
  detectRepoContextFromFindings,
  generateRegressionChecklist,
} from "@/lib/patch-kit/generate-regression-checklist";
import { generateCursorPrompt } from "@/lib/patch-kit/generate-cursor-prompt";
import type { VerifyCheckResult } from "@/lib/jobs/types";
import { runOneFixAtATimeLoop, countDiffLines } from "./one-fix-at-a-time";
import {
  hashPatchContent,
  hashVerification,
  type ExecutionReceipt,
} from "@/lib/operator/sign-receipt";
import { summarizeBaselineReport } from "./baseline-verification";
import { resolveFixPlugin } from "./fix-plugins";

export interface FileChange {
  path: string;
  findingIds: string[];
}

export interface FreeCleanupResult {
  id: string;
  mode: "auto_fix" | "review_plan";
  selectedFindings: Finding[];
  skippedCount: number;
  fileChanges: FileChange[];
  unifiedDiff: string;
  patchStatus: "validated" | "review_plan_only" | "failed";
  patchValidation?: { status: string; error?: string };
  verification: {
    status: "passed" | "failed" | "partial" | "not_run";
    checks: VerifyCheckResult[];
    limitations: string[];
    baselineSummary?: string[];
  };
  fixLoop: {
    selected: number;
    verified: number;
    skipped: number;
    rejected: number;
    attempts: Array<{
      findingId: string;
      title: string;
      status: string;
      reason: string;
      pluginId: string;
    }>;
  };
  metrics: {
    issuesSelected: number;
    issuesChanged: number;
    filesChanged: number;
    linesAdded: number;
    linesRemoved: number;
  };
  artifacts: {
    reportMd: string;
    cleanupPromptMd: string;
    regressionChecklistMd: string;
    selectedFindingsJson: string;
  };
  limitations: string[];
  verifiedLabel: string;
  receipt: ExecutionReceipt;
}

function flattenAll(payload: FindingsPayload): Finding[] {
  return [
    ...payload.duplicates,
    ...payload.unused.files,
    ...payload.unused.dependencies,
    ...payload.unused.exports,
    ...payload.orphans,
    ...payload.slopSignals,
  ];
}

function buildReviewReport(findings: Finding[], payload: FindingsPayload, note: string): string {
  const lines = [
    "# RepoDiet Cleanup Report",
    "",
    `Repository: ${payload.repo.owner}/${payload.repo.name}`,
    `Branch: ${payload.repo.branch}`,
    "",
    "## Selected findings",
    "",
  ];
  for (const f of findings) {
    lines.push(`- **${f.title}** (${f.type}) — ${f.files.join(", ") || f.packageName}`);
    lines.push(`  - ${f.reason}`);
    lines.push(`  - Plugin: ${resolveFixPlugin(f).label}`);
  }
  lines.push("", "## Note", "", note);
  return lines.join("\n");
}

function selectedPayload(payload: FindingsPayload, selected: Finding[]): FindingsPayload {
  const ids = new Set(selected.map((f) => f.id));
  const keep = (items: Finding[]) => items.filter((f) => ids.has(f.id));
  return {
    ...payload,
    duplicates: keep(payload.duplicates),
    unused: {
      files: keep(payload.unused.files),
      dependencies: keep(payload.unused.dependencies),
      exports: keep(payload.unused.exports),
    },
    orphans: keep(payload.orphans),
    slopSignals: keep(payload.slopSignals),
  };
}

export async function runFreeCleanupCore(
  payload: FindingsPayload,
  options?: { findingIds?: string[]; maxFixes?: number }
): Promise<FreeCleanupResult> {
  const maxFixes = options?.maxFixes ?? FREE_CLEANUP_LIMIT;
  const all = flattenAll(payload);
  const id = `cleanup_${nanoid(12)}`;
  const limitations: string[] = [];

  let selected: Finding[];
  let mode: "auto_fix" | "review_plan";

  if (options?.findingIds?.length) {
    const idSet = new Set(options.findingIds.slice(0, maxFixes));
    const picked = all.filter((f) => idSet.has(f.id));
    const auto = picked.filter(isAutoFixEligible);
    selected = auto.length > 0 ? auto.slice(0, maxFixes) : picked.slice(0, maxFixes);
    mode = auto.length > 0 ? "auto_fix" : "review_plan";
  } else {
    const auto = listAutoFixEligible(all).slice(0, maxFixes);
    if (auto.length > 0) {
      selected = auto;
      mode = "auto_fix";
    } else {
      selected = listReviewPlanEligible(all).slice(0, maxFixes);
      mode = "review_plan";
    }
  }

  const skippedCount = all.length - selected.length;
  const context = detectRepoContextFromFindings(payload);
  const subset = selectedPayload(payload, selected);
  const buckets = classifyFindingsForPatch(subset);
  const { markdown: regressionChecklistMd } = generateRegressionChecklist(
    context,
    context.packageManager
  );
  const cleanupPromptMd = generateCursorPrompt(payload, buckets, context);

  const commitSha = payload.repo.commitSha ?? "unknown";

  if (mode === "review_plan" || selected.length === 0) {
    const receipt: ExecutionReceipt = {
      taskId: id,
      repository: `${payload.repo.owner}/${payload.repo.name}`,
      commitSha,
      findingIds: selected.map((f) => f.id),
      patchHash: hashPatchContent(""),
      verificationHash: hashVerification([]),
      status: "review_plan",
      timestamp: new Date().toISOString(),
    };
    return {
      id,
      mode: "review_plan",
      selectedFindings: selected,
      skippedCount,
      fileChanges: [],
      unifiedDiff: "",
      patchStatus: "review_plan_only",
      verification: {
        status: "not_run",
        checks: [],
        limitations: ["No automatic changes generated."],
      },
      fixLoop: { selected: 0, verified: 0, skipped: 0, rejected: 0, attempts: [] },
      metrics: {
        issuesSelected: selected.length,
        issuesChanged: 0,
        filesChanged: 0,
        linesAdded: 0,
        linesRemoved: 0,
      },
      artifacts: {
        reportMd: buildReviewReport(
          selected,
          payload,
          "No safe automatic patch was generated. RepoDiet created a conservative review plan instead."
        ),
        cleanupPromptMd,
        regressionChecklistMd,
        selectedFindingsJson: JSON.stringify(selected, null, 2),
      },
      limitations: [
        "No findings met RepoDiet's automatic-fix safety threshold.",
        "Review plan only — no code changes were applied.",
      ],
      verifiedLabel: "Review plan prepared",
      receipt,
    };
  }

  const repoUrl =
    payload.repo.url ?? `https://github.com/${payload.repo.owner}/${payload.repo.name}`;
  const workspace = await prepareRepoWorkspace(repoUrl, payload.repo.branch);

  try {
    const loop = await runOneFixAtATimeLoop(workspace.rootDir, selected, { maxFixes });
    const { added, removed } = countDiffLines(loop.unifiedDiff);

    const allChecks = loop.attempts.flatMap((a) => a.checks);
    const verified = loop.metrics.verified > 0;
    const patchStatus = verified ? "validated" : "failed";

    const baselineSummary = loop.retained[0]?.baselineReport
      ? summarizeBaselineReport(loop.retained[0].baselineReport)
      : undefined;

    if (loop.metrics.verified === 0 && loop.metrics.rejected > 0) {
      limitations.push("RepoDiet refused unsupported or protected findings.");
    }
    if (loop.metrics.skipped > 0) {
      limitations.push(`${loop.metrics.skipped} finding(s) skipped after verification.`);
    }

    const fileChanges: FileChange[] = loop.deletedPaths.map((rel) => ({
      path: rel,
      findingIds: selected.filter((f) => f.files.includes(rel)).map((f) => f.id),
    }));

    const verificationStatus: FreeCleanupResult["verification"]["status"] = verified
      ? "passed"
      : loop.attempts.length > 0
        ? "partial"
        : "not_run";

    const receipt: ExecutionReceipt = {
      taskId: id,
      repository: `${payload.repo.owner}/${payload.repo.name}`,
      commitSha,
      findingIds: loop.retained.map((r) => r.finding.id),
      patchHash: hashPatchContent(loop.unifiedDiff),
      verificationHash: hashVerification(allChecks),
      status: verified ? "verified" : "partial",
      timestamp: new Date().toISOString(),
    };

    return {
      id,
      mode: "auto_fix",
      selectedFindings: selected,
      skippedCount,
      fileChanges,
      unifiedDiff: loop.unifiedDiff,
      patchStatus,
      patchValidation: loop.retained[0]?.patchValidation,
      verification: {
        status: verificationStatus,
        checks: allChecks,
        limitations,
        baselineSummary,
      },
      fixLoop: {
        selected: loop.metrics.selected,
        verified: loop.metrics.verified,
        skipped: loop.metrics.skipped,
        rejected: loop.metrics.rejected,
        attempts: loop.attempts.map((a) => ({
          findingId: a.finding.id,
          title: a.finding.title,
          status: a.status,
          reason: a.reason,
          pluginId: a.pluginId,
        })),
      },
      metrics: {
        issuesSelected: selected.length,
        issuesChanged: loop.metrics.verified,
        filesChanged: loop.deletedPaths.length,
        linesAdded: added,
        linesRemoved: removed,
      },
      artifacts: {
        reportMd: buildReviewReport(
          selected,
          payload,
          loop.deletedPaths.length > 0
            ? `${loop.metrics.verified} verified fix(es), ${loop.deletedPaths.length} file(s) changed in isolated workspace. Your GitHub repository was not modified.`
            : "No safe file changes were retained after verification."
        ),
        cleanupPromptMd,
        regressionChecklistMd,
        selectedFindingsJson: JSON.stringify(selected, null, 2),
      },
      limitations,
      verifiedLabel: verified
        ? "One safe fix verified"
        : "No safe fix retained — see fix loop details",
      receipt,
    };
  } finally {
    await workspace.cleanup();
  }
}
