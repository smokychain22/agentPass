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
import { filterOperatorSafeDeletes } from "./safety";

export type CleanupPrMode = "safe_only" | "report_only";

export interface CreateCleanupPrInput {
  repoUrl: string;
  branch?: string;
  githubToken?: string;
  mode?: CleanupPrMode;
  findings?: FindingsPayload;
  patchKit?: PatchKitPayload;
  demo?: boolean;
}

const ARTIFACT_PATHS = {
  report: "repodiet/repodiet-report.md",
  regression: "repodiet/regression-checklist.md",
  cursor: "repodiet/cursor-prompt.md",
  findings: "repodiet/findings.json",
  summary: "repodiet/patchkit-summary.json",
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

function buildPrTitle(validatedEdits: number, filesDeleted: number): string {
  const total = validatedEdits + filesDeleted;
  if (total <= 0) return `${PR_TITLE_PREFIX} cleanup bundle`;
  return `${PR_TITLE_PREFIX} ${total} verified repository issue${total === 1 ? "" : "s"}`;
}

function buildPrBody(
  mode: CleanupPrMode,
  safePaths: string[],
  findings: FindingsPayload,
  buckets: ClassifiedBuckets,
  patchKit: PatchKitPayload,
  validatedEditPaths: string[]
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
    `- Files edited: **${pk.filesEdited ?? validatedEditPaths.length}**`,
    `- Files deleted: **${pk.filesDeleted ?? safePaths.length}**`,
    `- Lines added: **${pk.patchLines ? "see patch" : "—"}**`,
    `- Patch validation: **${patchKit.patchValidation?.status ?? pk.patchValidationStatus ?? "unknown"}**`,
    "",
  ];

  if (validatedEditPaths.length > 0) {
    lines.push("### Edited files", "", ...validatedEditPaths.map((p) => `- \`${p}\``), "");
  }

  if (mode === "safe_only" && safePaths.length > 0) {
    lines.push("### Deleted files", "", ...safePaths.map((p) => `- \`${p}\``), "");
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
    });
    const client = new GitHubClient(token);
    const meta = await client.getRepo(parsed.owner, parsed.repo);
    return { client, meta };
  })();

  const client = repoMeta.client;
  const baseBranch = input.branch?.trim() || parsed.branch || repoMeta.meta.defaultBranch;
  const cleanupBranch = buildCleanupBranchName();

  const findings = await resolveFindings(input);
  const patchKit = await resolvePatchKit(input, findings);
  const buckets = classifyFindingsForPatch(findings);
  const safePaths = filterOperatorSafeDeletes(buckets.safeDelete.map((item) => item.path));
  const validatedChanges = patchKit.summary.validatedChanges ?? 0;
  const validatedEdits = patchKit.validatedEdits ?? [];

  if (mode === "safe_only" && validatedChanges === 0 && validatedEdits.length === 0 && safePaths.length === 0) {
    throw new ToolExecutionError(
      "NO_SAFE_CANDIDATES",
      "No validated cleanup changes to apply. Generate repairs in Quick Cleanup first, or use report_only mode for an audit PR.",
      422
    );
  }

  if (mode === "safe_only" && patchKit.patchValidation?.status !== "passed") {
    throw new ToolExecutionError(
      "NO_SAFE_CANDIDATES",
      "Cleanup patch did not pass validation. Regenerate repairs before creating a cleanup PR.",
      422
    );
  }

  const baseSha = await client.getBranchSha(parsed.owner, parsed.repo, baseBranch);
  await client.createBranch(parsed.owner, parsed.repo, cleanupBranch, baseSha);

  const warnings: string[] = [];
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
    for (const edit of validatedEdits) {
      await client.upsertFile(
        parsed.owner,
        parsed.repo,
        edit.path,
        cleanupBranch,
        edit.content,
        `RepoDiet: apply validated cleanup edit to ${edit.path}`
      );
    }

    for (const path of safePaths) {
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

  const validatedEditPaths = validatedEdits.map((e) => e.path);
  const prTitle = buildPrTitle(validatedEdits.length, safePaths.length);

  const pr = await client.createPullRequest(
    parsed.owner,
    parsed.repo,
    prTitle,
    cleanupBranch,
    baseBranch,
    buildPrBody(mode, safePaths, findings, buckets, patchKit, validatedEditPaths)
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
          mode === "safe_only" ? validatedEdits.length + filesDeleted : 0,
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
