/**
 * Deterministic replacement for the Gemini-backed `ModelTurn`.
 *
 * `next-action`'s own output is already the decision — a fixed, CLI-generated
 * playbook naming the exact command to run next (see `next-action-playbook.ts`).
 * Handing that playbook to a general conversational model to "decide what to
 * do" was pure overhead: it added a rate-limited, quota-capped, and (as
 * confirmed live in production on job
 * 0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6 on
 * 2026-08-03) occasionally misclassifying dependency onto the mandatory
 * protocol path, for work that is either a direct CLI call or — for the one
 * genuinely judgment-requiring step, preparing the cleanup deliverable — a
 * call into RepoDiet's own proven, deterministic analysis pipeline
 * (`createCleanupPullRequest`, the same function the ASP job executor and the
 * paid A2MCP tools use).
 *
 * This turn never calls an LLM. An unrecognized playbook shape or a missing
 * required field returns `{ ok: false, status: undefined }`, which the
 * existing retry policy (`decideRetry`) treats as `internal_failure_retryable`
 * — bounded, honestly reported, never a fabricated success and never a silent
 * drop.
 */
import { createCleanupPullRequest } from "@/lib/operator/create-cleanup-pr";
import { ToolExecutionError } from "@/lib/a2mcp/errors";
import { GitHubClient } from "@/lib/github/github-client";
import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import { resolveCleanupGitHubToken } from "@/lib/github-app/resolve-cleanup-token";
import type { InstructionFetcher, ModelTurn, TaskReader } from "./provider-event-executor";
import type { ProposedAction } from "./system-event-route";
import { parseTaskContext } from "./task-context-fetcher";
import {
  fillNotifyTemplate,
  isWakeupRedirectPlaybook,
  resolveWakeupRedirect,
  flattenForCliArgument,
  parseNextActionPlaybook,
} from "./next-action-playbook";
import { runProcess, type ProcessRunResult } from "./process-runner";
import { ONCHAINOS } from "./system-event-adapters";

export interface DeterministicTurnOptions {
  agentId: string;
  env?: NodeJS.ProcessEnv;
  runner?: typeof runProcess;
  /** Reused so the deterministic turn reads task detail through the exact same adapter as the executor. */
  readTask: TaskReader;
  /**
   * Seam for tests — production uses the real pipeline. Kept minimal
   * (repoUrl only, plus the deterministic branch — see cleanupBranchForJob)
   * because `createCleanupPullRequest` resolves its own findings/patch kit
   * when not pre-supplied.
   */
  createCleanupPr?: typeof createCleanupPullRequest;
  /** Seam for tests — production resolves the real GitHub App token. */
  resolveGitHubToken?: typeof resolveCleanupGitHubToken;
  /**
   * Seam for tests — production constructs a real `GitHubClient`. Only
   * `listOpenPullRequestsForHeadPrefix` is used, for the pre-flight
   * duplicate-PR check.
   */
  createGitHubClient?: (token: string) => Pick<GitHubClient, "listOpenPullRequestsForHeadPrefix">;
  /**
   * Re-requests the playbook for a different event. Required to follow a
   * `wakeup_notify` redirect; production wires the same
   * `createInstructionFetcher` the executor itself uses.
   */
  refetchInstruction?: InstructionFetcher;
}

/**
 * Deterministic and derived only from the OKX jobId — stable across every
 * retry of this event AND across a fresh event delivery for the same job
 * (a `wakeup_notify`-triggered re-send, for instance).
 *
 * This is what makes `job_accepted` execution safe to retry: an earlier
 * attempt that created the cleanup PR but failed on a *later* step (the
 * deliver action, or a crash before the ledger recorded it) leaves a real,
 * findable PR on this exact branch, so a retry reuses it instead of running
 * the analysis pipeline again and opening a duplicate.
 *
 * `createCleanupPullRequest`'s own built-in idempotency lookup
 * (`getCleanupPrDelivery`, in cleanup-pr-delivery-ledger.ts) is keyed by
 * `patchKit.id`, which is a fresh random id every call this route makes —
 * it never pre-supplies a patch kit, so that lookup can never match here.
 * The branch-based pre-check below is what actually closes the gap for this
 * caller specifically.
 */
export function cleanupBranchForJob(jobId: string): string {
  const suffix = jobId.replace(/^0x/, "").slice(0, 40);
  return `repodiet/cleanup-okx-${suffix}`;
}

function buildNotifyAction(content: string): ProposedAction {
  return { command: "agent user-notify", args: ["--content", flattenForCliArgument(content)] };
}

async function fetchCommonContext(
  jobId: string,
  options: DeterministicTurnOptions
): Promise<ProcessRunResult> {
  const run = options.runner ?? runProcess;
  return run(
    ONCHAINOS,
    ["agent", "common", "context", jobId, "--role", "asp", "--agent-id", options.agentId],
    { env: options.env, timeoutMs: 60_000 }
  );
}

/**
 * Builds the deterministic `ModelTurn`. Wired in at the same seam
 * `createModelTurn` (the Gemini adapter) occupied — see
 * `scripts/repodiet-seller-runtime.ts`'s `buildSystemEventDeps`.
 */
export function createDeterministicTurn(options: DeterministicTurnOptions): ModelTurn {
  const createPr = options.createCleanupPr ?? createCleanupPullRequest;
  const resolveToken = options.resolveGitHubToken ?? resolveCleanupGitHubToken;
  const buildClient =
    options.createGitHubClient ?? ((token: string) => new GitHubClient(token));

  return async ({ instruction, jobId, envelope }) => {
    let plan = parseNextActionPlaybook(instruction);

    /**
     * A `wakeup_notify` playbook is a REDIRECT, not an instruction: it says
     * the real business state is in `message.jobStatus` and the playbook must
     * be re-requested with that as `--event`.
     *
     * Traced live: without this, event 456f7e76 on the already-accepted,
     * escrow-funded job 0x22a2… retried every 60s forever and never
     * delivered — the OKX-reported timeout class exactly.
     *
     * The redirect target comes from the ENVELOPE, never from the playbook
     * prose, and is restricted to a known status set, so generated text can
     * never choose which playbook runs.
     */
    if (isWakeupRedirectPlaybook(instruction)) {
      const message = (envelope?.message ?? {}) as { jobStatus?: unknown };
      const redirect = resolveWakeupRedirect(message.jobStatus);
      if (redirect.kind !== "wakeup_redirect") {
        return {
          ok: false,
          actions: [],
          status: undefined,
          error: "wakeup_redirect_status_unresolved",
        };
      }
      if (!options.refetchInstruction) {
        return {
          ok: false,
          actions: [],
          status: undefined,
          error: "wakeup_redirect_unsupported",
        };
      }
      const followed = await options.refetchInstruction({
        event: redirect.jobStatus,
        jobId,
        envelope: { ...envelope, message: { ...message, event: redirect.jobStatus } } as never,
      });
      if (!followed.ok) {
        return { ok: false, actions: [], status: followed.status, error: "wakeup_redirect_fetch_failed" };
      }
      plan = parseNextActionPlaybook(followed.stdout);
      if (isWakeupRedirectPlaybook(followed.stdout)) {
        // A redirect that redirects again would loop. Follow exactly one hop.
        return {
          ok: false,
          actions: [],
          status: undefined,
          error: "wakeup_redirect_loop",
        };
      }
    }

    if (plan.kind === "notify_only") {
      return { ok: true, actions: [buildNotifyAction(plan.content)] };
    }

    if (plan.kind === "wakeup_redirect" || plan.kind === "unrecognized") {
      // Never guess a state transition — stay retryable and bounded by
      // MAX_ATTEMPTS so an unfamiliar shape surfaces for investigation
      // instead of either hanging forever or fabricating an action.
      return {
        ok: false,
        actions: [],
        status: undefined,
        error: "next_action_playbook_unrecognized",
      };
    }

    // plan.kind === "job_accepted_execute": the only step that does real
    // work. Task detail (tokenAmount/tokenSymbol) comes from the same
    // authoritative reader the executor itself uses; repository/title/
    // description come from `agent common context`, exactly as next-action's
    // own Step 0 instructs.
    const task = await options.readTask(jobId);
    const contextResult = await fetchCommonContext(jobId, options);
    if (!contextResult.ok) {
      return { ok: false, actions: [], status: undefined, error: "common_context_unavailable" };
    }
    const context = parseTaskContext(contextResult.stdout);

    if (!context.repositoryUrl) {
      // The one field this route will never guess: which repository to
      // clone and write to.
      return { ok: false, actions: [], status: undefined, error: "repository_url_unresolved" };
    }

    const notifyContent = fillNotifyTemplate(plan.notifyTemplate, {
      title: context.title,
      description: context.description,
      tokenAmount: task?.tokenAmount ?? context.tokenAmount,
      tokenSymbol: task?.tokenSymbol ?? context.tokenSymbol,
    });

    const parsedRepo = parseGitHubUrl(context.repositoryUrl);
    if (!parsedRepo) {
      return { ok: false, actions: [], status: undefined, error: "repository_url_invalid" };
    }
    const branch = cleanupBranchForJob(jobId);

    let prUrl: string;
    try {
      const token = await resolveToken({
        repoUrl: context.repositoryUrl,
        owner: parsedRepo.owner,
        repo: parsedRepo.repo,
      });
      const client = buildClient(token);
      const existing = await client.listOpenPullRequestsForHeadPrefix(
        parsedRepo.owner,
        parsedRepo.repo,
        branch
      );
      if (existing.length > 0) {
        // A prior attempt on this exact job already opened this PR — reuse
        // it. Never re-run the pipeline once a deliverable exists for this
        // jobId; that would be a duplicate PR for the same paid task.
        prUrl = existing[0].url;
      } else {
        const pr = await createPr({
          repoUrl: context.repositoryUrl,
          mode: "safe_only",
          cleanupBranch: branch,
          githubToken: token,
        });
        prUrl = pr.data.pullRequest.url;
      }
    } catch (err) {
      const message =
        err instanceof ToolExecutionError
          ? `${err.code}:${err.message}`
          : err instanceof Error
            ? err.message
            : "cleanup_pr_failed";
      return { ok: false, actions: [], status: undefined, error: message };
    }

    const deliverText = `RepoDiet Verified Cleanup — pull request ready for review: ${prUrl}`;

    const deliverAction: ProposedAction = {
      command: "agent deliver",
      args: [
        jobId,
        "--file",
        "",
        "--agent-id",
        options.agentId,
        "--deliverable-text",
        deliverText,
      ],
    };

    return {
      ok: true,
      actions: [buildNotifyAction(notifyContent), deliverAction],
    };
  };
}
