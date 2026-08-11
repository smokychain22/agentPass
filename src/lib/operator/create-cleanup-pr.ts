import { ToolExecutionError } from "@/lib/a2mcp/errors";
import { resolveCleanupGitHubToken } from "@/lib/github-app/resolve-cleanup-token";
import { runFindingsEngine } from "@/lib/findings/findings-engine";
import type { FindingsPayload } from "@/lib/findings/types";
import { GitHubClient } from "@/lib/github/github-client";
import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import { classifyFindingsForPatch } from "@/lib/patch-kit/safe-delete-classifier";
import type { ClassifiedBuckets } from "@/lib/patch-kit/types";
import { runPatchKitEngine } from "@/lib/patch-kit/patch-kit-engine";
import { withRefreshedVerificationGates } from "@/lib/patch-kit/refresh-verification-gates";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
import { nanoid } from "nanoid";
import { assertCleanupDeliveryContext } from "./cleanup-delivery-guard";
import { resolvePrRepairStrategy, type PrRepairResolution } from "./pr-repair";
import { resolveValidatedDeliveryOps, normalizeApprovedPaths } from "./delivery-operations";
import { getCleanupPrDelivery, recordCleanupPrDelivery } from "./cleanup-pr-delivery-ledger";
import { summarizeVerificationForDiagnostics } from "./verification-diagnostics";
import { runExclusiveHeavyJob } from "@/lib/okx-runtime/heavy-job-limiter";
import {
  buildMaintenanceOutcome,
  type MaintenanceOutcome,
} from "@/lib/maintenance/outcome";

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
  cleanupBranch?: string;
  approvedPaths?: string[];
  /** PR number from a prior attempt on this same paid task, if any — enables same-PR repair (Part 12E) instead of always creating a new PR. */
  existingPrNumber?: number;
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
  findings: FindingsPayload,
  approvedDeletePaths: string[]
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
    /**
     * The approval scope must reach the engine, because the engine is where
     * repository verification happens. Passing it later — after the kit is
     * built, which is where the delivery filter runs — is exactly the ordering
     * defect this fixes: verification would describe a superset tree that
     * includes candidates this delivery will never ship.
     */
    approvedDeletePaths,
  });
}

const PR_TITLE_PREFIX = "RepoDiet: repair";

/**
 * Classifies a single requested-delete outcome. Exported and pure so the
 * idempotency fix below is directly unit-testable without mocking
 * GitHubClient or exercising the surrounding network-calling function.
 *
 * `deleted === false` means the path was already absent on that branch.
 * On a freshly created branch that is a genuine anomaly (the delete
 * `resolveValidatedDeliveryOps` validated isn't actually there). On a
 * REUSED branch it is exactly what a repeat delivery looks like — a prior
 * attempt already removed it — and must be classified as satisfied, not
 * as evidence nothing was ever approved.
 */
export function classifyDeleteOutcome(
  deleted: boolean,
  reuseExistingBranch: boolean
): "applied" | "already_satisfied" | "not_found" {
  if (deleted) return "applied";
  return reuseExistingBranch ? "already_satisfied" : "not_found";
}

/**
 * Whether a "no approved cleanup operation was applied" delivery failure
 * is genuine. Reproduced live: an identical retry of a delivery already
 * present on a reused branch threw NO_SAFE_CANDIDATES because this check
 * only ever counted NEWLY-applied edits/deletes — never paths a prior
 * delivery had already satisfied on that same branch.
 */
export function hasNoDeliverableChange(counts: {
  editedCount: number;
  deletedCount: number;
  alreadySatisfiedCount: number;
}): boolean {
  return counts.editedCount === 0 && counts.deletedCount === 0 && counts.alreadySatisfiedCount === 0;
}

function buildCleanupBranchName(): string {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `repodiet/cleanup-${ymd}-${nanoid(6)}`;
}

function buildPrTitle(
  filesEdited: number,
  filesDeleted: number,
  maintenanceOutcome: MaintenanceOutcome
): string {
  if (
    maintenanceOutcome.kind === "exact_duplicate_canonicalization" &&
    maintenanceOutcome.canonicalizations.length === 1
  ) {
    const before = maintenanceOutcome.canonicalizations[0]!.beforeImplementations;
    return `RepoDiet: consolidate ${before} byte-identical implementations`;
  }
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
  filesDeleted: number,
  maintenanceOutcome: MaintenanceOutcome
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
    "### Purchased outcome",
    `**${maintenanceOutcome.headline}.**`,
    "",
    maintenanceOutcome.evidenceStatement,
    "",
  ];

  for (const canonicalization of maintenanceOutcome.canonicalizations) {
    lines.push(
      `- Canonical implementation: \`${canonicalization.canonicalPath}\``,
      `- Removed byte-identical copies: ${canonicalization.removedDuplicatePaths.map((path) => `\`${path}\``).join(", ")}`,
      `- Rewired importers: ${canonicalization.rewiredImporterPaths.length > 0 ? canonicalization.rewiredImporterPaths.map((path) => `\`${path}\``).join(", ") : "none required"}`,
      `- Content hash evidence: \`${canonicalization.contentHash}\``,
      ""
    );
  }

  lines.push(
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
    ""
  );

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

/**
 * === THE canonical machine-wide admission boundary for repository work ===
 *
 * Every production path that can start a repository cleanup goes through this
 * wrapper: the deterministic OKX turn, the ASP job executor, the A2A
 * orchestrator, the A2MCP phase-3 engine and its tool, the HTTP cleanup route,
 * the cleanup engine, and the production verification script.
 *
 * It exists because the previous arrangement only LOOKED machine-wide.
 * `runExclusiveHeavyJob` was documented as "machine-wide admission control"
 * but was applied at exactly one call site (`createDeterministicTurn`), while
 * `createCleanupPullRequest` had seven other callers that reached the heavy
 * pipeline without passing any limiter at all. The production verification
 * script was one of them, which is how a proof run and the live agent could
 * contend for the same 1-vCPU box.
 *
 * The boundary is placed HERE, at the single function every caller already
 * shares, rather than re-applied at each call site — a per-call-site guard is
 * exactly what failed, because a new caller silently opts out by forgetting
 * it. `createCleanupPullRequestUnlocked` is not exported from the package
 * index; it exists so this wrapper (and focused tests) can call the pipeline
 * body without recursing.
 *
 * Callers that previously wrapped this in their own `runExclusiveHeavyJob`
 * have had that wrapper REMOVED (see deterministic-turn.ts). Nesting would
 * make the inner acquisition see the outer's slot and reject itself with
 * `heavy_job_already_running` — a self-deadlock dressed as admission control.
 *
 * `HeavyJobRejected` propagates unchanged, so the executor keeps mapping it to
 * `internal_failure_retryable`: a busy or slow machine still never decides a
 * funded job's outcome.
 */
export async function createCleanupPullRequest(input: CreateCleanupPrInput) {
  const label = `cleanup_pr:${input.repoUrl || "unknown-repository"}`;
  return runExclusiveHeavyJob(label, () => createCleanupPullRequestUnlocked(input));
}

/**
 * The cleanup pipeline body. Deliberately NOT part of the public surface —
 * reaching this without passing `createCleanupPullRequest` bypasses the
 * machine's only heavy-work admission boundary.
 */
export async function createCleanupPullRequestUnlocked(input: CreateCleanupPrInput) {
  const { assertPreviewAllowsRepositoryWrite, PreviewDryRunError } = await import(
    "@/lib/deployment/preview-dry-run"
  );
  try {
    assertPreviewAllowsRepositoryWrite();
  } catch (err) {
    if (err instanceof PreviewDryRunError) {
      throw new ToolExecutionError(err.code, err.message, 403);
    }
    throw err;
  }

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

  // Reassigned before delivery — see Incident #37 below. Every delivery call
  // (branch create, file upsert/delete, PR create, repair lookup) must run on
  // the refreshed token, not the one minted before verification.
  let client = repoMeta.client;
  const baseBranch = input.branch?.trim() || parsed.branch || repoMeta.meta.defaultBranch;

  const findings = await resolveFindings(input);
  // Normalized once, centrally, for every caller of createCleanupPullRequest
  // (the manual route, the A2A orchestrator, phase3, and the ASP executor) —
  // see delivery-operations.ts's normalizeApprovedPaths docblock. Runs before
  // the mode check so a malformed approvedPaths input fails loudly even in
  // report_only mode, rather than being silently ignored.
  //
  // Hoisted above patch-kit resolution so the approval scope can reach the
  // engine's verification step. Validation still happens here and still throws
  // on malformed input, so hoisting cannot let a bad list through unchecked.
  const normalizedApprovedPaths = normalizeApprovedPaths(input.approvedPaths);
  const patchKit = withRefreshedVerificationGates(
    await resolvePatchKit(input, findings, normalizedApprovedPaths),
    findings
  );
  const buckets = classifyFindingsForPatch(findings);
  const validatedChanges = patchKit.summary.validatedChanges ?? 0;
  const validatedEdits = patchKit.validatedEdits ?? [];
  const deliveryOps =
    mode === "safe_only"
      ? resolveValidatedDeliveryOps(patchKit, validatedEdits, normalizedApprovedPaths)
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

  if (mode === "safe_only" && plannedEdits === 0 && plannedDeletes === 0) {
    throw new ToolExecutionError(
      "NO_SAFE_CANDIDATES",
      deliveryOps.skippedDeletePaths.length > 0
        ? `No approved cleanup operation passed the final delivery safety gate. Blocked paths: ${deliveryOps.skippedDeletePaths.join(", ")}`
        : "No approved cleanup operation passed the final delivery safety gate.",
      422,
      // Structured so a caller (the deterministic job_accepted turn) can act
      // on the exact blocked paths without parsing the message string — see
      // buyer-delete-approval-requests.ts, which uses this to ask the buyer
      // for explicit per-job approval instead of requiring a developer to
      // hand-review and hardcode an entry in job-delivery-approvals.ts.
      deliveryOps.skippedDeletePaths.length > 0
        ? { skippedDeletePaths: [...deliveryOps.skippedDeletePaths] }
        : undefined
    );
  }

  if (mode === "safe_only" && (patchKit.summary.verifiedChanges ?? 0) === 0) {
    /**
     * Row 8 (2026-08-09/74e73ad, 7003d0f): the terse `.error` string alone
     * left no way to tell which check/install attempt actually consumed the
     * time, or whether a killed process's report matched a real elapsed
     * duration — exactly the kind of ambiguity Incident #35's diagnostics
     * fixes exist to remove. `repositoryVerification.checks`/`.installAttempts`
     * already carry real per-step `durationMs`; they were computed and then
     * discarded before reaching any caller. Attaching a compact projection as
     * `details` costs nothing (never serialized into any user/API response —
     * see `ToolExecutionError`) and turns the next failure into evidence
     * instead of another guess.
     */
    const verification = patchKit.repositoryVerification;
    throw new ToolExecutionError(
      "NO_SAFE_CANDIDATES",
      verification?.error ??
        "No verified cleanup changes to apply. Complete repository verification before creating a cleanup PR.",
      422,
      summarizeVerificationForDiagnostics(verification)
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
    const failedGates = patchKit.verificationGates.gates.filter(
      (g) => g.requiredForSafePr && g.status === "failed"
    );
    const failed = failedGates.map((g) => g.label);
    const details = failedGates
      .map((g) => g.detail)
      .filter((d): d is string => Boolean(d?.trim()))
      .slice(0, 3);
    throw new ToolExecutionError(
      "NO_SAFE_CANDIDATES",
      `Mandatory verification gates failed: ${failed.join("; ") || "see pr-evidence-report"}${
        details.length ? ` (${details.join(" | ")})` : ""
      }`,
      422
    );
  }

  const warnings: string[] = [];
  warnings.push(...deliveryOps.skippedDeletePaths.map((p) => `Delete skipped by operator safety policy: ${p}`));

  /**
   * === Incident #37: the GitHub App token expired mid-job ===
   *
   * The token above is minted ONCE, before analysis and verification, and the
   * same client was then reused here for every delivery call. A GitHub App
   * installation token lives ~1 hour, and everything between those two points
   * — clone, analyze, baseline install/typecheck/test/build, patch
   * application, patched install/typecheck/test/build — is unbounded-ish
   * heavy work that legitimately takes tens of minutes on a shared vCPU.
   *
   * Measured on repodiet-agent-9636: a run that finally got verification to
   * PASS took 64.7 minutes end to end and then died on the very first
   * delivery call with
   *
   *   Bad credentials (GET /repos/velz-cmd/repodiet-e2e-test/git/ref/heads/...
   *   -> 401)
   *
   * having done every expensive thing correctly first. The bigger the
   * customer's repository, the more certain this failure becomes — it is the
   * large jobs, the ones worth the most, that are guaranteed to hit it.
   *
   * Re-resolving immediately before delivery costs one cheap call and makes
   * the delivery phase depend on a token minted seconds earlier rather than
   * an hour earlier.
   *
   * `input.githubToken` is deliberately NOT forwarded here, unlike the
   * initial resolution above. `resolveCleanupGitHubToken` returns an
   * explicitly-supplied `githubToken` verbatim rather than minting fresh
   * (see resolve-cleanup-token.ts) — forwarding it here would make this
   * whole block a no-op for exactly the callers who supply one (the CLI
   * proof included), silently reusing the same token this block exists to
   * replace. Proved live: the first shipped version of this fix forwarded
   * `input.githubToken` and failed with the identical `Bad credentials` 401
   * at this exact call site 76.8 minutes into the next production run.
   * Omitting it forces the GitHub App installation-token path every time,
   * which is what "refresh" has to mean for this to do anything.
   */
  client = new GitHubClient(
    await resolveCleanupGitHubToken({
      demo: input.demo,
      repoUrl: input.repoUrl,
      owner: parsed.owner,
      repo: parsed.repo,
      sessionKey: input.sessionKey,
    })
  );

  const deliveryContext = await assertCleanupDeliveryContext({
    client,
    owner: parsed.owner,
    repo: parsed.repo,
    baseBranch,
    scanCommitSha: findings.repo.commitSha,
    validatedEdits: mode === "safe_only" ? deliveryOps.contentEdits : [],
    deletePaths: mode === "safe_only" ? deliveryOps.deletePaths : [],
  });
  warnings.push(...deliveryContext.warnings);

  const baseSha = deliveryContext.liveBaseSha;

  // Idempotency: a caller retrying the exact same patch kit — same
  // patchKitId, therefore the same authorized scope — must be routed back
  // to whatever it delivered last time, not handed a fresh branch name.
  // Only engages when the caller has no tracking of its own; the paid A2A
  // orchestrator, phase3, and the ASP executor already pass their own
  // existingPrNumber/cleanupBranch and take priority over this lookup. See
  // cleanup-pr-delivery-ledger.ts for the defect this closes.
  let resolvedExistingPrNumber = input.existingPrNumber;
  let resolvedCleanupBranch = input.cleanupBranch;
  if (
    mode === "safe_only" &&
    resolvedExistingPrNumber === undefined &&
    !resolvedCleanupBranch?.trim()
  ) {
    const priorDelivery = await getCleanupPrDelivery(patchKit.id);
    if (priorDelivery && priorDelivery.owner === parsed.owner && priorDelivery.repo === parsed.repo) {
      resolvedExistingPrNumber = priorDelivery.prNumber;
      resolvedCleanupBranch = priorDelivery.branch;
    }
  }

  const requestedBranch = resolvedCleanupBranch?.trim() || buildCleanupBranchName();

  let repair: PrRepairResolution | undefined;
  if (resolvedExistingPrNumber !== undefined) {
    repair = await resolvePrRepairStrategy(client, {
      owner: parsed.owner,
      repo: parsed.repo,
      cleanupBranch: requestedBranch,
      existingPrNumber: resolvedExistingPrNumber,
    });
    if (repair.reason) warnings.push(repair.reason);
  }

  // A replacement can never reuse the original (possibly unusable) branch
  // name — it always gets a fresh one, even if that name happened to exist.
  const cleanupBranch =
    repair?.action === "replacement_required" && repair.branchExists
      ? `${requestedBranch}-replacement-${nanoid(6)}`
      : requestedBranch;

  if (!/^repodiet\/(?:cleanup|green-pr)-[A-Za-z0-9._-]+$/.test(cleanupBranch) ||
      cleanupBranch.includes("..")) {
    throw new ToolExecutionError("INVALID_INPUT", "Invalid RepoDiet cleanup branch name.", 400);
  }

  const reuseExistingBranch = repair?.action === "reuse_existing_branch_and_pr";
  if (!reuseExistingBranch) {
    await client.createBranch(parsed.owner, parsed.repo, cleanupBranch, baseSha);
  }

  let filesDeleted = 0;
  const deletedPathsApplied: string[] = [];
  const alreadySatisfiedPaths: string[] = [];

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

  if (mode === "report_only") {
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
      switch (classifyDeleteOutcome(deleted, reuseExistingBranch)) {
        case "applied":
          filesDeleted += 1;
          deletedPathsApplied.push(path);
          break;
        case "already_satisfied":
          alreadySatisfiedPaths.push(path);
          warnings.push(`Already applied on the reused branch from a prior delivery: ${path}`);
          break;
        case "not_found":
          warnings.push(`Safe candidate not found on branch and was skipped: ${path}`);
          break;
      }
    }
  }

  const editedPaths = deliveryOps.contentEdits.map((e) => e.path);
  if (
    mode === "safe_only" &&
    hasNoDeliverableChange({
      editedCount: editedPaths.length,
      deletedCount: deletedPathsApplied.length,
      alreadySatisfiedCount: alreadySatisfiedPaths.length,
    })
  ) {
    throw new ToolExecutionError(
      "NO_SAFE_CANDIDATES",
      "No approved cleanup operation was applied. RepoDiet did not create an artifacts-only pull request.",
      422
    );
  }
  const deliveredPathSet = new Set(
    [...editedPaths, ...deletedPathsApplied, ...alreadySatisfiedPaths].map((filePath) =>
      filePath.replace(/\\/g, "/").replace(/^\.\//, "")
    )
  );
  const maintenanceOutcome = buildMaintenanceOutcome({
    findings,
    changeOperations: patchKit.changeOperations?.filter((operation) =>
      deliveredPathSet.has(operation.filePath.replace(/\\/g, "/").replace(/^\.\//, ""))
    ),
    verificationStatus:
      patchKit.repositoryVerification?.status ??
      patchKit.patchValidation?.status ??
      "unknown",
    deliveryState: "delivered",
  });
  const prTitle = buildPrTitle(editedPaths.length, filesDeleted, maintenanceOutcome);

  // Same-PR repair (Part 12E): when the original pull request and branch
  // are both still usable, push the corrected commits to them and reuse
  // the existing PR rather than opening a second one.
  const pr =
    repair?.action === "reuse_existing_branch_and_pr" && repair.existingPr
      ? { url: repair.existingPr.url, number: repair.existingPr.number }
      : await client.createPullRequest(
          parsed.owner,
          parsed.repo,
          prTitle,
          cleanupBranch,
          baseBranch,
          buildPrBody(
            mode,
            deletedPathsApplied,
            findings,
            buckets,
            patchKit,
            editedPaths,
            filesDeleted,
            maintenanceOutcome
          )
        );

  if (mode === "safe_only") {
    // Best-effort — a ledger write failure must never fail an otherwise
    // successful delivery; it only means the NEXT retry falls back to
    // creating a fresh branch instead of reusing this one.
    try {
      await recordCleanupPrDelivery(patchKit.id, {
        owner: parsed.owner,
        repo: parsed.repo,
        prNumber: pr.number,
        branch: cleanupBranch,
      });
    } catch {
      // See comment above.
    }
  }

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
      repair: repair
        ? {
            action: repair.action,
            reason: repair.reason,
            originalPrNumber: repair.existingPr?.number,
          }
        : undefined,
      baseAutoRecovered: deliveryContext.baseAutoRecovered,
      actionSummary: {
        mode,
        maintenanceOutcome,
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
