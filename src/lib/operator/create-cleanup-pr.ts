import { ToolExecutionError } from "@/lib/a2mcp/errors";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import { runFindingsEngine } from "@/lib/findings/findings-engine";
import type { FindingsPayload } from "@/lib/findings/types";
import { GitHubClient } from "@/lib/github/github-client";
import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import { classifyFindingsForPatch } from "@/lib/patch-kit/safe-delete-classifier";
import { runPatchKitEngine } from "@/lib/patch-kit/patch-kit-engine";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
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

function resolveGitHubToken(input: CreateCleanupPrInput): string {
  if (input.demo) {
    if (!isDemoRepoUrl(input.repoUrl)) {
      throw new ToolExecutionError(
        "DEMO_REPO_ONLY",
        "Demo mode only works with the configured demo repository.",
        403
      );
    }
    const token = process.env.GITHUB_DEMO_TOKEN?.trim();
    if (!token) {
      throw new ToolExecutionError(
        "INTERNAL_ERROR",
        "Demo GitHub token is not configured on the server.",
        500
      );
    }
    return token;
  }

  const token = input.githubToken?.trim();
  if (!token) {
    throw new ToolExecutionError(
      "MISSING_GITHUB_TOKEN",
      "A fine-grained GitHub token is required to open a cleanup pull request.",
      401
    );
  }
  return token;
}

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

function buildCleanupBranchName(): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `repodiet/cleanup-${stamp}`;
}

function buildPrTitle(mode: CleanupPrMode, safeCount: number): string {
  if (mode === "report_only") {
    return "RepoDiet: audit report and regression checklist";
  }
  return `RepoDiet: safe cleanup (${safeCount} file${safeCount === 1 ? "" : "s"})`;
}

function buildPrBody(
  mode: CleanupPrMode,
  safePaths: string[],
  reviewFirstCount: number,
  doNotTouchCount: number
): string {
  const lines = [
    "## RepoDiet Operator cleanup PR",
    "",
    "This pull request was opened by [RepoDiet Operator](https://github.com/smokychain22/agentPass).",
    "",
    "### Mode",
    `- \`${mode}\``,
    "",
    "### Safety policy",
    "- No direct pushes to the default branch",
    "- Human merge required",
    "- Review-first and do-not-touch findings were not deleted",
    "- Routes, configs, env files, lockfiles, and public assets remain protected",
    "",
    "### Action summary",
    `- Safe candidates applied: **${mode === "safe_only" ? safePaths.length : 0}**`,
    `- Review-first items skipped: **${reviewFirstCount}**`,
    `- Do-not-touch items protected: **${doNotTouchCount}**`,
    "",
    "### Artifacts added",
    "- `repodiet/repodiet-report.md`",
    "- `repodiet/regression-checklist.md`",
    "- `repodiet/cursor-prompt.md`",
    "- `repodiet/findings.json`",
    "- `repodiet/patchkit-summary.json`",
    "",
  ];

  if (mode === "safe_only" && safePaths.length > 0) {
    lines.push("### Safe deletions", "", ...safePaths.map((p) => `- \`${p}\``), "");
  }

  lines.push(
    "### Before merging",
    "",
    "1. Review every deleted file",
    "2. Run the regression checklist in `repodiet/regression-checklist.md`",
    "3. Merge only after build, lint, and route checks pass"
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
  const token = resolveGitHubToken(input);
  const client = new GitHubClient(token);

  const repoMeta = await client.getRepo(parsed.owner, parsed.repo);
  const baseBranch = input.branch?.trim() || parsed.branch || repoMeta.defaultBranch;
  const cleanupBranch = buildCleanupBranchName();

  const findings = await resolveFindings(input);
  const patchKit = await resolvePatchKit(input, findings);
  const buckets = classifyFindingsForPatch(findings);
  const safePaths = filterOperatorSafeDeletes(buckets.safeDelete.map((item) => item.path));

  if (mode === "safe_only" && safePaths.length === 0) {
    throw new ToolExecutionError(
      "NO_SAFE_CANDIDATES",
      "No safe cleanup PR created because this repo has no safe candidates. Use report_only mode to create an audit PR.",
      422
    );
  }

  const baseSha = await client.getBranchSha(parsed.owner, parsed.repo, baseBranch);
  await client.createBranch(parsed.owner, parsed.repo, cleanupBranch, baseSha);

  const warnings: string[] = [];
  let filesDeleted = 0;

  if (mode === "safe_only") {
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

  const pr = await client.createPullRequest(
    parsed.owner,
    parsed.repo,
    buildPrTitle(mode, safePaths.length),
    cleanupBranch,
    baseBranch,
    buildPrBody(mode, safePaths, buckets.reviewFirst.length, buckets.doNotTouch.length)
  );

  return {
    data: {
      repo: {
        owner: parsed.owner,
        name: parsed.repo,
        baseBranch,
        cleanupBranch,
      },
      pullRequest: {
        url: pr.url,
        number: pr.number,
        title: buildPrTitle(mode, safePaths.length),
      },
      actionSummary: {
        mode,
        filesDeleted,
        artifactsAdded: artifactEntries.length,
        safeCandidatesApplied: mode === "safe_only" ? filesDeleted : 0,
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
