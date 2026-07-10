import path from "node:path";
import { nanoid } from "nanoid";
import type { Finding, FindingsPayload } from "@/lib/findings/types";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { generateUnifiedDeletePatch } from "@/lib/patch-kit/generate-unified-diff";
import { validateCleanupPatchInWorkspace } from "@/lib/patch-kit/validate-patch";
import type { ClassifiedItem } from "@/lib/patch-kit/types";
import type { VerifyCheckResult } from "@/lib/jobs/types";
import {
  FREE_CLEANUP_LIMIT,
  isAutoFixEligible,
  listAutoFixEligible,
  listReviewPlanEligible,
} from "./eligibility";
import { generateCursorPrompt } from "@/lib/patch-kit/generate-cursor-prompt";
import { classifyFindingsForPatch } from "@/lib/patch-kit/safe-delete-classifier";
import {
  detectRepoContextFromFindings,
  generateRegressionChecklist,
} from "@/lib/patch-kit/generate-regression-checklist";

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
    lines.push(`  - Analyzer: ${f.source} (${f.sourceMode}), confidence ${Math.round(f.confidence * 100)}%`);
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

export async function runFreeCleanup(
  payload: FindingsPayload,
  selectedFindingIds?: string[]
): Promise<FreeCleanupResult> {
  const all = flattenAll(payload);
  const id = `cleanup_${nanoid(12)}`;
  const limitations: string[] = [];

  let selected: Finding[];
  let mode: "auto_fix" | "review_plan";

  if (selectedFindingIds?.length) {
    const idSet = new Set(selectedFindingIds.slice(0, FREE_CLEANUP_LIMIT));
    const picked = all.filter((f) => idSet.has(f.id));
    const auto = picked.filter(isAutoFixEligible);
    selected = auto.length > 0 ? auto : picked;
    mode = auto.length > 0 ? "auto_fix" : "review_plan";
  } else {
    const auto = listAutoFixEligible(all);
    if (auto.length > 0) {
      selected = auto;
      mode = "auto_fix";
    } else {
      selected = listReviewPlanEligible(all);
      mode = "review_plan";
    }
  }

  const skippedCount = all.length - selected.length;
  const context = detectRepoContextFromFindings(payload);
  const subset = selectedPayload(payload, selected);
  const buckets = classifyFindingsForPatch(subset);
  const { markdown: regressionChecklistMd } = generateRegressionChecklist(context, context.packageManager);
  const cleanupPromptMd = generateCursorPrompt(payload, buckets, context);

  if (mode === "review_plan" || selected.length === 0) {
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
    };
  }

  const safeItems: ClassifiedItem[] = [];
  for (const f of selected) {
    for (const file of f.files) {
      safeItems.push({
        path: file,
        reason: f.reason,
        findingId: f.id,
        findingType: f.type,
      });
    }
  }

  const repoUrl =
    payload.repo.url ?? `https://github.com/${payload.repo.owner}/${payload.repo.name}`;
  const workspace = await prepareRepoWorkspace(repoUrl, payload.repo.branch);

  try {
    const { patch: unifiedDiff, deletedPaths } = await generateUnifiedDeletePatch(
      workspace.rootDir,
      safeItems
    );

    const patchValidation = await validateCleanupPatchInWorkspace(workspace.rootDir, unifiedDiff);
    const { added, removed } = countDiffLines(unifiedDiff);

    const checks: VerifyCheckResult[] = [
      {
        name: "git apply --check",
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
    ];

    const patchStatus =
      patchValidation.status === "passed" && deletedPaths.length > 0 ? "validated" : "failed";

    if (deletedPaths.length === 0) {
      limitations.push("No files could be safely deleted for the selected findings.");
    }
    if (patchValidation.status !== "passed") {
      limitations.push(patchValidation.error ?? "Patch validation failed.");
    }

    const fileChanges: FileChange[] = deletedPaths.map((rel) => ({
      path: rel,
      findingIds: selected.filter((f) => f.files.includes(rel)).map((f) => f.id),
    }));

    const allPassed = checks.every((c) => c.status === "passed" || c.status === "skipped");
    const verifiedLabel = allPassed && deletedPaths.length > 0
      ? "Safe changes verified"
      : "Changes generated — verification needs review";

    return {
      id,
      mode: "auto_fix",
      selectedFindings: selected,
      skippedCount,
      fileChanges,
      unifiedDiff,
      patchStatus,
      patchValidation,
      verification: {
        status: allPassed && deletedPaths.length > 0 ? "passed" : deletedPaths.length > 0 ? "partial" : "not_run",
        checks,
        limitations,
      },
      metrics: {
        issuesSelected: selected.length,
        issuesChanged: deletedPaths.length > 0 ? selected.length : 0,
        filesChanged: deletedPaths.length,
        linesAdded: added,
        linesRemoved: removed,
      },
      artifacts: {
        reportMd: buildReviewReport(
          selected,
          payload,
          deletedPaths.length > 0
            ? `${deletedPaths.length} file(s) removed in isolated workspace. Your GitHub repository was not modified.`
            : "No safe file deletions were generated."
        ),
        cleanupPromptMd,
        regressionChecklistMd,
        selectedFindingsJson: JSON.stringify(selected, null, 2),
      },
      limitations,
      verifiedLabel,
    };
  } finally {
    await workspace.cleanup();
  }
}
