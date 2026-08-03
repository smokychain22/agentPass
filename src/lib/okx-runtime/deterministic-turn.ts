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
import type { ModelTurn, TaskReader } from "./provider-event-executor";
import type { ProposedAction } from "./system-event-route";
import { parseTaskContext } from "./task-context-fetcher";
import {
  fillNotifyTemplate,
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
   * (repoUrl only) because `createCleanupPullRequest` resolves its own
   * findings/patch kit/GitHub token when not pre-supplied.
   */
  createCleanupPr?: typeof createCleanupPullRequest;
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

  return async ({ instruction, jobId }) => {
    const plan = parseNextActionPlaybook(instruction);

    if (plan.kind === "notify_only") {
      return { ok: true, actions: [buildNotifyAction(plan.content)] };
    }

    if (plan.kind === "unrecognized") {
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

    let pr: Awaited<ReturnType<typeof createCleanupPullRequest>>;
    try {
      pr = await createPr({ repoUrl: context.repositoryUrl, mode: "safe_only" });
    } catch (err) {
      const message =
        err instanceof ToolExecutionError
          ? `${err.code}:${err.message}`
          : err instanceof Error
            ? err.message
            : "cleanup_pr_failed";
      return { ok: false, actions: [], status: undefined, error: message };
    }

    const deliverText = `RepoDiet Verified Cleanup — pull request ready for review: ${pr.data.pullRequest.url}`;

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
