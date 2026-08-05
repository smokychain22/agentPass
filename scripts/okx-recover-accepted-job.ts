#!/usr/bin/env tsx
/**
 * One-shot recovery for a single ACCEPTED-but-undelivered OKX job.
 *
 * The daemon's open-job sweep only reconciles jobs at `created`, and the
 * deliverable for an `accepted` job is produced exclusively by an official
 * `job_accepted` system event. A job whose event was never delivered
 * therefore sits funded and unworked with nothing pending to replay. This
 * command is the operator-invoked reconciler for exactly that state — see
 * `accepted-job-recovery.ts` for why it queries authoritative state rather
 * than writing a synthetic event into the spool.
 *
 * Usage:
 *   npm run okx:recover-accepted-job -- --job-id 0x<64hex> [--dry-run]
 *
 * Refuses unless OKX's own reading says the job is accepted, ours, from the
 * pinned buyer, at the registered 1 USD₮0 price, escrow-funded, with no
 * existing deliverable and an authenticated GitHub App installation. Safe to
 * run repeatedly: a job that already has a deliverable is skipped, and an
 * already-open PR on the deterministic branch is reused, never duplicated.
 */
import {
  parseDeliverableCount,
  recoverAcceptedJob,
  REPODIET_A2A_RECOVERY_POLICY,
  type AcceptedJobRecoveryDeps,
} from "../src/lib/okx-runtime/accepted-job-recovery";
import { createDeterministicTurn } from "../src/lib/okx-runtime/deterministic-turn";
import {
  createActionRunner,
  createInstructionFetcher,
  createOpenJobTaskReader,
  createTaskReader,
  ONCHAINOS,
} from "../src/lib/okx-runtime/system-event-adapters";
import { OKX_SYSTEM_EVENT_AGENT_ID } from "../src/lib/okx-runtime/system-event-agent";
import { OKX_RUNTIME_IDENTITIES } from "../src/lib/okx-runtime/runtime-layout";
import { runProcess } from "../src/lib/okx-runtime/process-runner";
import { GitHubClient } from "../src/lib/github/github-client";
import { resolveCleanupGitHubToken } from "../src/lib/github-app/resolve-cleanup-token";

const SELLER = OKX_RUNTIME_IDENTITIES.seller;

function log(event: string, fields: Record<string, unknown>): void {
  process.stdout.write(
    JSON.stringify({ at: new Date().toISOString(), event, ...fields }) + "\n"
  );
}

function parseArgs(argv: string[]): {
  jobId?: string;
  dryRun: boolean;
  expectedBuyer?: string;
} {
  let jobId: string | undefined;
  let dryRun = false;
  let expectedBuyer: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--job-id" || argv[i] === "--jobId") jobId = argv[i + 1];
    if (argv[i] === "--expected-buyer" || argv[i] === "--expectedBuyer") {
      expectedBuyer = argv[i + 1];
    }
    if (argv[i] === "--dry-run") dryRun = true;
  }
  return { jobId, dryRun, expectedBuyer };
}

/**
 * Official deliverable list. Throws on a failed read so the caller records
 * "unknown" rather than "none" — the gate refuses on unknown.
 *
 * Takes ONLY `--job-id`. Verified against the live CLI: passing `--agent-id`
 * here exits 2 with `unexpected argument '--agent-id'`, because a job id
 * already identifies the job uniquely and this subcommand takes nothing else.
 * The first live dry-run of this script did exactly that, so every invocation
 * refused with `deliverable_state_uncertain` — the fail-closed path behaving
 * correctly on an argument list that could never have succeeded.
 */
async function listDeliverables(jobId: string): Promise<number> {
  const result = await runProcess(
    ONCHAINOS,
    ["agent", "task-deliverable-list", "--job-id", jobId],
    { timeoutMs: 60_000 }
  );
  if (!result.ok) throw new Error("deliverable_list_unavailable");
  return parseDeliverableCount(result.stdout);
}

async function main(): Promise<void> {
  const { jobId, dryRun, expectedBuyer } = parseArgs(process.argv.slice(2));
  if (!jobId) {
    log("accepted_job_recovery_usage_error", { error: "--job-id is required" });
    process.exit(2);
  }
  // Named explicitly per invocation — never defaulted. See
  // AcceptedJobRecoveryPolicy.expectedBuyerAgentId.
  if (!expectedBuyer) {
    log("accepted_job_recovery_usage_error", {
      error: "--expected-buyer is required; recovery must name the authorized counterparty",
    });
    process.exit(2);
  }

  const adapterOptions = {
    agentId: SELLER.agentId,
    systemEventAgentId: OKX_SYSTEM_EVENT_AGENT_ID,
    env: process.env,
  };

  const fetchInstruction = createInstructionFetcher(adapterOptions);
  const runAction = createActionRunner(adapterOptions);

  const deps: AcceptedJobRecoveryDeps = {
    policy: { ...REPODIET_A2A_RECOVERY_POLICY, expectedBuyerAgentId: expectedBuyer },
    readTask: createOpenJobTaskReader(adapterOptions),
    listDeliverables,
    hasInstallationAccess: async (owner, repo) => {
      try {
        await resolveCleanupGitHubToken({
          repoUrl: `https://github.com/${owner}/${repo}`,
          owner,
          repo,
        });
        return true;
      } catch {
        return false;
      }
    },
    findExistingPr: async (owner, repo, branch) => {
      const token = await resolveCleanupGitHubToken({
        repoUrl: `https://github.com/${owner}/${repo}`,
        owner,
        repo,
      });
      const open = await new GitHubClient(token).listOpenPullRequestsForHeadPrefix(
        owner,
        repo,
        branch
      );
      return open[0]?.url;
    },
    fetchInstruction,
    // The SAME deterministic turn the event path runs — never a second,
    // divergent implementation of the delivery pipeline.
    runTurn: createDeterministicTurn({
      ...adapterOptions,
      readTask: createTaskReader(adapterOptions),
      refetchInstruction: fetchInstruction,
    }),
    runAction: async (action) => {
      const result = await runAction(action);
      return {
        ok: result.ok,
        transactionRef: result.transactionRef,
        error: result.error,
        // A failed-but-broadcast action may already be in flight. Reported as
        // uncertain so it is never retried blindly.
        uncertain: !result.ok && result.broadcast,
      };
    },
    log,
    dryRun,
  };

  const outcome = await recoverAcceptedJob(jobId, deps);
  log("accepted_job_recovery_outcome", { ...outcome });
  process.exit(outcome.action === "failed" ? 1 : 0);
}

main().catch((err) => {
  log("accepted_job_recovery_crashed", {
    message: err instanceof Error ? err.message : "unknown_error",
  });
  process.exit(1);
});
