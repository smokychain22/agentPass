/**
 * Real CLI-backed adapters for the system-event route.
 *
 * Every one is an argv array through runProcess — never an interpolated shell
 * string, and never `shell: true`. That is not decoration: these argv arrays
 * carry model-proposed content, and the authorization boundary
 * (authorizeAction) is only meaningful if the values it approved are the exact
 * values that reach execve.
 */
import {
  runProcess,
  type ProcessRunResult,
} from "./process-runner";
import type {
  ActionRunner,
  InstructionFetcher,
  ModelTurn,
  Reconciler,
  StatusPublisher,
  TaskReader,
} from "./provider-event-executor";
import type { AuthoritativeTask, ProposedAction } from "./system-event-route";

export const ONCHAINOS = "onchainos";
export const OKX_A2A = "okx-a2a";
export const OPENCLAW = "openclaw";

export interface AdapterOptions {
  agentId: string;
  systemEventAgentId: string;
  env?: NodeJS.ProcessEnv;
  runner?: typeof runProcess;
}

/** `onchainos agent status` status names → protocol statusCode. */
const STATUS_CODES: Record<string, number> = {
  created: 0,
  accepted: 1,
  submitted: 2,
  refused: 3,
  disputed: 4,
  complete: 5,
  completed: 5,
  close: 6,
  closed: 6,
  expired: 7,
  rejected: 8,
  admin_stopped: 9,
};

/**
 * Parses the real `onchainos agent status <jobId>` text output, e.g.
 *
 *   Task status: accepted
 *     jobId:    0x3846…
 *     budget:   1 USDT
 *     user:    5295
 *     asp: 9636
 *
 * Returns undefined rather than guessing when a field is missing — the
 * authorization boundary must never run against a half-parsed task.
 */
export function parseTaskStatus(stdout: string): AuthoritativeTask | undefined {
  const status = /Task status:\s*(\w+)/i.exec(stdout)?.[1]?.toLowerCase();
  const jobId = /jobId:\s*(0x[0-9a-f]{64})/i.exec(stdout)?.[1];
  const budget = /budget:\s*([0-9.]+)\s*(\w+)/i.exec(stdout);
  const user = /^\s*user:\s*(\d+)/im.exec(stdout)?.[1];
  const asp = /^\s*asp:\s*(\d+)/im.exec(stdout)?.[1];

  if (!status || !jobId || !budget || !user || !asp) return undefined;
  const statusCode = STATUS_CODES[status];
  if (statusCode === undefined) return undefined;

  return {
    jobId,
    aspAgentId: asp,
    buyerAgentId: user,
    statusCode,
    tokenAmount: budget[1],
    tokenSymbol: budget[2].toUpperCase(),
  };
}

export function createTaskReader(options: AdapterOptions): TaskReader {
  const run = options.runner ?? runProcess;
  return async (jobId) => {
    const result = await run(
      ONCHAINOS,
      ["agent", "status", jobId, "--agent-id", options.agentId],
      { env: options.env, timeoutMs: 60_000 }
    );
    if (!result.ok) return undefined;
    return parseTaskStatus(result.stdout);
  };
}

export function createInstructionFetcher(options: AdapterOptions): InstructionFetcher {
  const run = options.runner ?? runProcess;
  return async ({ envelope }) => {
    const result = await run(
      ONCHAINOS,
      [
        "agent",
        "next-action",
        "--role",
        "asp",
        "--agentId",
        options.agentId,
        "--message",
        JSON.stringify(envelope.message ?? envelope),
      ],
      { env: options.env, timeoutMs: 120_000 }
    );
    return {
      ok: result.ok,
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.ok ? undefined : providerStatusFrom(result),
    };
  };
}

/**
 * Runs the model turn against the ISOLATED agent, which is the only identity
 * bound to a model. `--agent okx-system-events` is what keeps this off the main
 * agent (whose default remains openai/gpt-5.5) — ordinary buyer chat can never
 * reach here because it never gets this far in the route.
 */
export function createModelTurn(options: AdapterOptions): ModelTurn {
  const run = options.runner ?? runProcess;
  return async ({ instruction, jobId }) => {
    const result = await run(
      OPENCLAW,
      [
        "agent",
        "--agent",
        options.systemEventAgentId,
        "--local",
        "--json",
        "--timeout",
        "180",
        "--session-key",
        `okx-system-event:${jobId}`,
        "--message",
        instruction,
      ],
      { env: options.env, timeoutMs: 240_000 }
    );

    if (!result.ok) {
      return {
        ok: false,
        actions: [],
        status: providerStatusFrom(result),
        retryAfterSeconds: retryAfterFrom(result),
        error: result.stderr.slice(0, 500),
      };
    }

    return {
      ok: true,
      invocationId: /"runId"\s*:\s*"([^"]+)"/.exec(result.stdout)?.[1],
      actions: parseProposedActions(result.stdout),
    };
  };
}

/**
 * Extracts the actions a turn proposes.
 *
 * Nothing here is trusted — whatever comes out is handed straight to
 * authorizeAction(), which re-checks command, argv, job, provider, amount and
 * token against the authoritative task record. A malformed or hostile payload
 * yields no actions, which the executor treats as "work not done" (retryable,
 * never acknowledged), not as success.
 */
export function parseProposedActions(stdout: string): ProposedAction[] {
  const key = /"repodietActions"\s*:\s*\[/.exec(stdout);
  if (!key) return [];
  // Balanced scan, not a regex: a non-greedy `\[...\]` stops at the first `]`,
  // which is the nested `args` array, silently truncating every real payload.
  const slice = extractBalancedArray(stdout, key.index + key[0].length - 1);
  if (!slice) return [];
  try {
    const parsed: unknown = JSON.parse(slice);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const command = (entry as ProposedAction).command;
      const args = (entry as ProposedAction).args;
      if (typeof command !== "string" || !Array.isArray(args)) return [];
      if (!args.every((a) => typeof a === "string")) return [];
      return [{ command, args }];
    });
  } catch {
    return [];
  }
}

/**
 * Returns the JSON array starting at `start`, matching brackets while skipping
 * over string literals and escapes. Returns undefined if it never closes.
 */
function extractBalancedArray(source: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return undefined;
}

/**
 * Splits an allowlisted command into an executable + argv.
 *
 * The allowlist mixes two shapes: `okx-a2a xmtp-send`, where the head IS the
 * binary, and `agent deliver`, where the head is onchainos's first SUBCOMMAND
 * (the real CLI is `onchainos agent deliver <jobId>` — verified against
 * `onchainos agent --help`). An earlier revision stripped the head in both
 * cases, which silently turned every provider action into `onchainos deliver
 * …` — not a valid command, so no delivery could ever have landed. The head is
 * therefore dropped only when it is genuinely the binary name.
 */
export function resolveExecutable(action: ProposedAction): { bin: string; argv: string[] } {
  const parts = action.command.trim().split(/\s+/);
  const bin = parts[0] === OKX_A2A ? OKX_A2A : ONCHAINOS;
  const subcommands = parts[0] === bin ? parts.slice(1) : parts;
  return { bin, argv: [...subcommands, ...action.args] };
}

export function createActionRunner(options: AdapterOptions): ActionRunner {
  const run = options.runner ?? runProcess;
  return async (action) => {
    const { bin, argv } = resolveExecutable(action);
    const result = await run(bin, argv, { env: options.env, timeoutMs: 300_000 });

    if (result.ok) {
      return { ok: true, transactionRef: transactionRefFrom(result.stdout), broadcast: true };
    }

    // A timeout is the dangerous case: the transaction may already be signed and
    // in flight. Report it as broadcast-with-unknown-outcome so the executor
    // reconciles instead of re-sending.
    const inFlight = result.timedOut || /broadcast|submitted|pending/i.test(result.stdout);
    return {
      ok: false,
      broadcast: inFlight,
      transactionRef: transactionRefFrom(result.stdout),
      error: result.timedOut ? "action_timeout_outcome_unknown" : result.stderr.slice(0, 500),
    };
  };
}

/**
 * Reconciles a broadcast of unknown outcome by re-reading authoritative state.
 * A deliver is confirmed once the task has left `accepted` — that transition is
 * the protocol's own evidence the submission landed.
 */
export function createReconciler(options: AdapterOptions): Reconciler {
  const readTask = createTaskReader(options);
  return async ({ jobId, action }) => {
    const task = await readTask(jobId);
    if (!task) return { completed: false };
    if (action.command === "agent deliver") {
      return { completed: task.statusCode >= 2 };
    }
    return { completed: false };
  };
}

/**
 * Publishes the buyer-facing status.
 *
 * The counterparty is read from authoritative task detail, never configured and
 * never taken from the model's proposal. A configured buyer id would be wrong
 * on any job whose client is not that agent, and would also mean the seller
 * runtime carried the buyer identity around — which it must not, since it is
 * the one process that must never be able to act as the buyer.
 *
 * An unresolvable counterparty is a publication FAILURE, not a silent skip: the
 * executor keeps the event replayable and, because the action is already
 * recorded, replay resumes at publication without repeating the action.
 */
export function createStatusPublisher(options: AdapterOptions): StatusPublisher {
  const run = options.runner ?? runProcess;
  const readTask = createTaskReader(options);
  return async ({ jobId, transactionRef }) => {
    const task = await readTask(jobId);
    if (!task) return { ok: false, error: "counterparty_unresolved" };

    const message = transactionRef
      ? `RepoDiet: provider action confirmed on job ${jobId} (ref ${transactionRef}).`
      : `RepoDiet: provider action confirmed on job ${jobId}.`;
    const result = await run(
      OKX_A2A,
      ["xmtp-send", "--job-id", jobId, "--to-agent-id", task.buyerAgentId, "--message", message],
      { env: options.env, timeoutMs: 90_000 }
    );
    return {
      ok: result.ok,
      messageId: /"messageId"\s*:\s*"([^"]+)"/.exec(result.stdout)?.[1],
      error: result.ok ? undefined : result.stderr.slice(0, 300),
    };
  };
}

function transactionRefFrom(stdout: string): string | undefined {
  return (
    /"(?:txHash|transactionHash|hash)"\s*:\s*"(0x[0-9a-f]+)"/i.exec(stdout)?.[1] ??
    /\b(0x[0-9a-f]{64})\b/i.exec(stdout)?.[1]
  );
}

/**
 * Best-effort HTTP status recovery from CLI output, for the retry policy.
 *
 * Only the 400-599 error range is trusted. `openclaw agent --local --json`
 * (the CLI this scans) logs its own internal provider calls verbatim into the
 * stdout/stderr this function reads — including success traces like
 * `[model-fetch] response ... status=200 ...` for HTTP calls that succeeded.
 * The regex has no way to tell "the status of the call that actually failed"
 * from "the status of some unrelated call the process happened to log", so a
 * 1xx/2xx/3xx match must never be trusted as a failure status: a successful
 * or redirect code can never be the reason `result.ok` is false. Passing one
 * through fed `decideRetry` a defined-but-unrecognized status, which falls
 * into its non_retryable catch-all — silently terminating a genuinely
 * retryable failure after a single attempt instead of leaving `status`
 * undefined (routed to `internal_failure_retryable`, bounded by
 * MAX_ATTEMPTS).
 *
 * Live in production on 2026-08-03 (job 0x22a216415e2b1176d2111b136584e42f…):
 * the `job_accepted` notification's model turn failed and was marked
 * `model_turn_terminal:non_retryable` on its very first attempt, even though
 * the runtime's own log showed the Gemini call it made 1.5s earlier returned
 * `status=200`. That trace line, not any real failure status, is what the
 * old unrestricted regex was matching.
 */
export function providerStatusFrom(result: ProcessRunResult): number | undefined {
  const match = /\b(?:status|HTTP)[ =:]*(\d{3})\b/i.exec(`${result.stdout}${result.stderr}`);
  const status = match ? Number(match[1]) : undefined;
  return status && status >= 400 && status < 600 ? status : undefined;
}

function retryAfterFrom(result: ProcessRunResult): number | undefined {
  const match = /retry[- ]after[ =:]*(\d+)/i.exec(`${result.stdout}${result.stderr}`);
  return match ? Number(match[1]) : undefined;
}
