import { ToolExecutionError } from "@/lib/a2mcp/errors";
import { resolveCleanupGitHubToken } from "@/lib/github-app/resolve-cleanup-token";
import { runFindingsEngine } from "@/lib/findings/findings-engine";
import type { FindingsPayload } from "@/lib/findings/types";
import { GitHubClient } from "@/lib/github/github-client";
import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import { classifyFindingsForPatch } from "@/lib/patch-kit/safe-delete-classifier";
import type { ClassifiedBuckets } from "@/lib/patch-kit/types";
import { runPatchKitEngine } from "@/lib/patch-kit/patch-kit-engine";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
import { nanoid } from "nanoid";
import { assertCleanupDeliveryContext } from "./cleanup-delivery-guard";
import { resolveValidatedDeliveryOps } from "./delivery-operations";

export type CleanupPrMode = "safe_only" | "report_only";

export interface CreateCleanupPrInput {
  repoUrl: string;
  branch?: string;
  githubToken?: string;
  mode?: CleanupPrMode;
  findings?: FindingsPayload;
  patchKit?: PatchKitPayload;
  demo?: boolean;
  sessionKey?: string;
}

const ARTIFACT_PATHS = {
  report: "repodiet/repodiet-report.md",
  regression: "repodiet/regression-checklist.md",
  cursor: "repodiet/cursor-prompt.md",
  findings: "repodiet/findings.json",
  summary: "repodiet/patchkit-summary.json",
  evidence: "repodiet/pr-evidence-report.md",
  sarif: "repodiet/findings.sarif.json",
} as const;

async function resolveFindings(input: CreateCleanupPrInput): Promise<FindingsPayload> {
  if (input.findings?.scanId && input.findings?.repo?.owner) {
    return input.findings;
  }
  if (input.patchKit?.artifacts?.findingsJson?.scanId) {
    return input.patchKit.artifacts.findingsJson;
  }
  return runFindingsEngine(input.repoUrl, input.branch);
}

async function resolvePatchKit(
  input: CreateCleanupPrInput,
  findings: FindingsPayload
): Promise<PatchKitPayload> {
  if (
    input.patchKit?.artifacts?.reportMd &&
    input.patchKit?.artifacts?.regressionChecklistMd &&
    input.patchKit?.artifacts?.cursorPromptMd
  ) {
    return input.patchKit;
  }
  return runPatchKitEngine({
    repoUrl: input.repoUrl,
    branch: input.branch ?? findings.repo.branch,
    findings,
  });
}

const PR_TITLE_PREFIX = "RepoDiet: repair";

function buildCleanupBranchName(): string {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `repodiet/cleanup-${ymd}-${nanoid(6)}`;
}

function buildPrTitle(filesEdited: number, filesDeleted: number): string {
  const total = filesEdited + filesDeleted;
  if (total <= 0) return `${PR_TITLE_PREFIX} cleanup bundle`;
  return `${PR_TITLE_PREFIX} ${total} verified repository issue${total === 1 ? "" : "s"}`;
}

function buildPrBody(
  mode: CleanupPrMode,
  deletedPaths: string[],
  findings: FindingsPayload,
  buckets: ClassifiedBuckets,
  patchKit: PatchKitPayload,
  editedPaths: string[],
  filesDeleted: number
): string {
  const s = findings.summary;
  const pk = patchKit.summary;
  const lines = [
    "## RepoDiet cleanup pull request",
    "",
    "This pull request contains **real source edits and/or deletions** produced by RepoDiet's deterministic repair engine.",
    "",
    "> RepoDiet did not push to main or merge this PR. You review and merge.",
    "",
    "### Scanned repository",
    `- Commit: \`${findings.repo.commitSha ?? "unknown"}\``,
    `- Branch: \`${findings.repo.branch}\``,
    `- Project root: \`${findings.repositoryModel?.primaryProjectRoot ?? "."}\``,
    "",
    "### Changes applied",
    `- Files edited: **${pk.filesEdited ?? editedPaths.length}**`,
    `- Files deleted: **${filesDeleted}**`,
    `- Lines added: **${pk.patchLines ? "see patch" : "—"}**`,
    `- Patch validation: **${patchKit.patchValidation?.status ?? pk.patchValidationStatus ?? "unknown"}**`,
    "",
  ];

  if (editedPaths.length > 0) {
    lines.push("### Edited files", "", ...editedPaths.map((p) => `- \`${p}\``), "");
  }

  if (mode === "safe_only" && deletedPaths.length > 0) {
    lines.push("### Deleted files", "", ...deletedPaths.map((p) => `- \`${p}\``), "");
  }

  lines.push(
    "### Findings summary",
    `- Duplicate clusters: **${s.duplicateClusters ?? 0}**`,
    `- Unused files: **${s.unusedFiles ?? 0}**`,
    `- Review-first items (not auto-applied): **${buckets.reviewFirst.length}**`,
    `- Protected items: **${buckets.doNotTouch.length}**`,
    "",
    "### Safety policy",
    "- No direct pushes to the default branch",
    "- Human merge required",
    "- Protected paths were not modified",
    "",
    "### Artifacts",
    "Supporting cleanup artifacts are included under `repodiet/`.",
    "- `repodiet/pr-evidence-report.md` — what was found, why verified, gates run, rollback steps",
    ""
  );

  return lines.join("\n");
}

export async function createCleanupPullRequest(input: CreateCleanupPrInput) {
  const parsed = parseGitHubUrl(input.repoUrl);
  if (!parsed) {
    throw new ToolExecutionError(
      "INVALID_INPUT",
      "repoUrl must be a valid public GitHub repository URL.",
      400
    );
  }

  const mode: CleanupPrMode = input.mode === "report_only" ? "report_only" : "safe_only";

  const repoMeta = await (async () => {
    const token = await resolveCleanupGitHubToken({
      demo: input.demo,
      repoUrl: input.repoUrl,
      owner: parsed.owner,
      repo: parsed.repo,
      githubToken: input.githubToken,
      sessionKey: input.sessionKey,
    });
    const client = new GitHubClient(token);
    const meta = await client.getRepo(parsed.owner, parsed.repo);
    return { client, meta };
  })();

  const client = repoMeta.client;
  const baseBranch = input.branch?.trim() || parsed.branch || repoMeta.meta.defaultBranch;

  const findings = await resolveFindings(input);
  const patchKit = await resolvePatchKit(input, findings);
  const buckets = classifyFindingsForPatch(findings);
  const validatedChanges = patchKit.summary.validatedChanges ?? 0;
  const validatedEdits = patchKit.validatedEdits ?? [];
  const deliveryOps =
    mode === "safe_only"
      ? resolveValidatedDeliveryOps(patchKit, validatedEdits)
      : { contentEdits: [], deletePaths: [], skippedDeletePaths: [] };
  const plannedDeletes = deliveryOps.deletePaths.length;
  const plannedEdits = deliveryOps.contentEdits.length;

  if (
    mode === "safe_only" &&
    validatedChanges === 0 &&
    plannedEdits === 0 &&
    plannedDeletes === 0
  ) {
    throw new ToolExecutionError(
      "NO_SAFE_CANDIDATES",
      "No validated cleanup changes to apply. Generate repairs in Quick Cleanup first, or use report_only mode for an audit PR.",
      422
    );
  }

  if (mode === "safe_only" && (patchKit.summary.verifiedChanges ?? 0) === 0) {
    throw new ToolExecutionError(
      "NO_SAFE_CANDIDATES",
      patchKit.repositoryVerification?.error ??
        "No verified cleanup changes to apply. Complete repository verification before creating a cleanup PR.",
      422
    );
  }

  if (mode === "safe_only" && patchKit.patchValidation?.status !== "passed") {
    throw new ToolExecutionError(
      "NO_SAFE_CANDIDATES",
      patchKit.patchValidation?.error ??
        "Cleanup patch did not pass repository validation (build/typecheck). Regenerate repairs before creating a cleanup PR.",
      422
    );
  }

  if (mode === "safe_only" && findings.scanCoverageWarning) {
    throw new ToolExecutionError(
      "NO_SAFE_CANDIDATES",
      findings.scanCoverageWarning,
      422
    );
  }

  if (
    mode === "safe_only" &&
    patchKit.verificationGates &&
    !patchKit.verificationGates.allRequiredPassed
  ) {
    const failed = patchKit.verificationGates.gates
      .filter((g) => g.requiredForSafePr && g.status === "failed")
      .map((g) => g.label);
    throw new ToolExecutionError(
      "NO_SAFE_CANDIDATES",
      `Mandatory verification gates failed: ${failed.join("; ") || "see pr-evidence-report"}`,
      422
    );
  }

  const warnings: string[] = [];
  warnings.push(...deliveryOps.skippedDeletePaths.map((p) => `Delete skipped by operator safety policy: ${p}`));

  const deliveryContext = await assertCleanupDeliveryContext({
    client,
    owner: parsed.owner,
    repo: parsed.repo,
    baseBranch,
    scanCommitSha: findings.repo.commitSha,
    validatedEdits: mode === "safe_only" ? deliveryOps.contentEdits : [],
  });
  warnings.push(...deliveryContext.warnings);

  const baseSha = deliveryContext.liveBaseSha;
  const cleanupBranch = buildCleanupBranchName();
  await client.createBranch(parsed.owner, parsed.repo, cleanupBranch, baseSha);

  let filesDeleted = 0;

  const artifacts = patchKit.artifacts;
  const artifactEntries: Array<{ path: string; content: string; message: string }> = [
    {
      path: ARTIFACT_PATHS.report,
      content: artifacts.reportMd,
      message: "RepoDiet: add cleanup report",
    },
    {
      path: ARTIFACT_PATHS.regression,
      content: artifacts.regressionChecklistMd,
      message: "RepoDiet: add regression checklist",
    },
    {
      path: ARTIFACT_PATHS.cursor,
      content: artifacts.cursorPromptMd,
      message: "RepoDiet: add Cursor cleanup prompt",
    },
    {
      path: ARTIFACT_PATHS.findings,
      content: JSON.stringify(artifacts.findingsJson, null, 2),
      message: "RepoDiet: add findings.json",
    },
    {
      path: ARTIFACT_PATHS.summary,
      content: artifacts.patchkitSummaryJson,
      message: "RepoDiet: add patchkit summary",
    },
  ];

  const evidenceMd =
    patchKit.prEvidenceReportMd ??
    (patchKit as { prEvidenceReportMd?: string }).prEvidenceReportMd;
  if (evidenceMd) {
    artifactEntries.push({
      path: ARTIFACT_PATHS.evidence,
      content: evidenceMd,
      message: "RepoDiet: add PR evidence report",
    });
  }

  if (patchKit.sarifBaseline) {
    artifactEntries.push({
      path: ARTIFACT_PATHS.sarif,
      content: JSON.stringify(patchKit.sarifBaseline, null, 2),
      message: "RepoDiet: add SARIF findings export",
    });
  }

  for (const artifact of artifactEntries) {
    await client.upsertFile(
      parsed.owner,
      parsed.repo,
      artifact.path,
      cleanupBranch,
      artifact.content,
      artifact.message
    );
  }

  if (mode === "safe_only") {
    for (const edit of deliveryOps.contentEdits) {
      await client.upsertFile(
        parsed.owner,
        parsed.repo,
        edit.path,
        cleanupBranch,
        edit.content,
        `RepoDiet: apply validated cleanup edit to ${edit.path}`
      );
    }

    for (const path of deliveryOps.deletePaths) {
      const deleted = await client.deleteFile(
        parsed.owner,
        parsed.repo,
        path,
        cleanupBranch,
        `RepoDiet: remove safe candidate ${path}`
      );
      if (deleted) {
        filesDeleted += 1;
      } else {
        warnings.push(`Safe candidate not found on branch and was skipped: ${path}`);
      }
    }
  }

  const editedPaths = deliveryOps.contentEdits.map((e) => e.path);
  const prTitle = buildPrTitle(editedPaths.length, filesDeleted);

  const pr = await client.createPullRequest(
    parsed.owner,
    parsed.repo,
    prTitle,
    cleanupBranch,
    baseBranch,
    buildPrBody(mode, deliveryOps.deletePaths, findings, buckets, patchKit, editedPaths, filesDeleted)
  );

  return {
    data: {
      repo: {
        owner: parsed.owner,
        name: parsed.repo,
        baseBranch,
        cleanupBranch,
        baseCommitSha: baseSha,
      },
      pullRequest: {
        url: pr.url,
        number: pr.number,
        title: prTitle,
      },
      actionSummary: {
        mode,
        filesDeleted,
        artifactsAdded: artifactEntries.length,
        safeCandidatesApplied:
          mode === "safe_only" ? editedPaths.length + filesDeleted : 0,
        reviewFirstSkipped: buckets.reviewFirst.length,
        doNotTouchSkipped: buckets.doNotTouch.length,
      },
      policy: {
        mainBranchMutated: false,
        safeCandidatesOnly: mode === "safe_only",
        reviewFirstExcluded: true,
        doNotTouchProtected: true,
        requiresHumanMerge: true,
      },
    },
    warnings,
  };
}
