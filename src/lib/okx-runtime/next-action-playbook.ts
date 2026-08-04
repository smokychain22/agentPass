/**
 * Deterministic parser for `onchainos agent next-action`'s stdout.
 *
 * next-action's output is a fixed, CLI-generated playbook, not free-form
 * prose: a short state header, then one or more steps, each either a fenced
 * ```bash``` block naming the exact CLI command to run (with a `content:`
 * block beneath a `user-notify` call) or, for the one step that genuinely
 * requires judgment ("autonomously execute the task and prepare the
 * deliverable"), no command at all. The CLI already decided what to do —
 * recognizing that fixed shape needs no model call. Only the single
 * judgment step is where real reasoning belongs, and it is scoped to the
 * actual repository cleanup, never to protocol mechanics.
 *
 * This parser is intentionally conservative: an unrecognized shape returns
 * `{ kind: "unrecognized" }` rather than a guess, so the caller can fail
 * safe (retryable, honestly reported) instead of fabricating a state
 * transition. It never executes anything itself — pure text in, plan out.
 */

export interface NotifyOnlyPlan {
  kind: "notify_only";
  /** Already-extracted, ready-to-send notify body — no placeholders left unresolved. */
  content: string;
}

export interface JobAcceptedPlan {
  kind: "job_accepted_execute";
  /**
   * The Step 1 notify body verbatim, still carrying `<title>` /
   * `<description>` / `<tokenAmount>` / `<tokenSymbol>` placeholders — the
   * parser never invents task data, so filling these is the caller's job
   * once it has authoritative task detail.
   */
  notifyTemplate: string;
}

/**
 * `wakeup_notify` is not a business event — it is a REDIRECT.
 *
 * Its playbook says so explicitly: "This is a wake-up heartbeat event, **NOT**
 * a business-driving event. The real business state is in the
 * envelope.message.jobStatus field… You should NOT use `wakeup_notify` as
 * --event", followed by an instruction to call next-action again with the
 * real status.
 *
 * Traced live on repodiet-agent-9636: event 456f7e76 on job 0x22a2…, an
 * already-`accepted` job with escrow funded, retried every 60 seconds and
 * failed every time with `model_turn_retryable:internal_failure_retryable`.
 * The turn was handed this redirect playbook, matched neither known shape,
 * and returned `unrecognized` — which is retryable, so it never became
 * terminal and never made progress either. The job sat undelivered.
 *
 * That is the OKX-reported failure class exactly: a task that is accepted,
 * paid for, and then simply times out. Recognising the redirect is what
 * closes it.
 */
export interface WakeupRedirectPlan {
  kind: "wakeup_redirect";
  /** The real business status to re-request the playbook with. */
  jobStatus: string;
}

export interface UnrecognizedPlan {
  kind: "unrecognized";
}

export type PlaybookPlan =
  | NotifyOnlyPlan
  | JobAcceptedPlan
  | WakeupRedirectPlan
  | UnrecognizedPlan;

/**
 * Statuses a wakeup redirect may legitimately name. Anything else is refused
 * rather than forwarded — the redirect target becomes an `--event` value, and
 * an unbounded one would let envelope content steer which playbook runs.
 */
const REDIRECTABLE_STATUSES = new Set([
  "created",
  "accepted",
  "submitted",
  "refused",
  "rejected",
  "disputed",
  "completed",
  "complete",
  "closed",
  "close",
  "failed",
  "expired",
]);

export function isWakeupRedirectPlaybook(stdout: string): boolean {
  return (
    stdout.includes("wakeup_notify") &&
    /NOT.{0,40}business.{0,20}event|wake-?up heartbeat/i.test(stdout)
  );
}

/**
 * Resolves the redirect target from the ORIGINAL envelope, never from the
 * playbook text. The playbook only says *where to look*; the value itself is
 * authoritative envelope data, and reading it from prose would let generated
 * text choose the next action.
 */
export function resolveWakeupRedirect(envelopeJobStatus: unknown): WakeupRedirectPlan | UnrecognizedPlan {
  if (typeof envelopeJobStatus !== "string") return { kind: "unrecognized" };
  const status = envelopeJobStatus.trim().toLowerCase();
  if (!REDIRECTABLE_STATUSES.has(status)) return { kind: "unrecognized" };
  return { kind: "wakeup_redirect", jobStatus: status };
}

const BASH_BLOCK = /```bash\n([\s\S]*?)```/g;
const CONTENT_LABEL = "content:";

/**
 * Extracts the free-text body after a `content:` label, stopping at the next
 * fence, the next `**Step`/`[Follow-up` heading, or end of string.
 */
function extractContentBlock(section: string): string | undefined {
  const marker = section.indexOf(CONTENT_LABEL);
  if (marker === -1) return undefined;
  const rest = section.slice(marker + CONTENT_LABEL.length);
  const stopMatch = /```|\n\*\*Step|\n\[Follow-up/.exec(rest);
  const raw = stopMatch ? rest.slice(0, stopMatch.index) : rest;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseNextActionPlaybook(stdout: string): PlaybookPlan {
  if (stdout.includes("[Current state] job_accepted")) {
    const stepOneIndex = stdout.indexOf("Step 1");
    const stepTwoIndex = stdout.indexOf("Step 2");
    if (stepOneIndex === -1 || stepTwoIndex === -1 || stepTwoIndex < stepOneIndex) {
      return { kind: "unrecognized" };
    }
    const stepOneSection = stdout.slice(stepOneIndex, stepTwoIndex);
    const notifyTemplate = extractContentBlock(stepOneSection);
    if (!notifyTemplate) return { kind: "unrecognized" };
    return { kind: "job_accepted_execute", notifyTemplate };
  }

  // Generic single-notify shape (job_asp_selected's "skip" case, and any
  // other event whose entire playbook is "tell the user X, end the turn"):
  // exactly one fenced command, and it must be `agent user-notify`.
  const matches = [...stdout.matchAll(BASH_BLOCK)];
  if (matches.length === 1 && matches[0][1].includes("agent user-notify")) {
    const bashBlock = matches[0];
    const afterBlock = stdout.slice((bashBlock.index ?? 0) + bashBlock[0].length);
    const content = extractContentBlock(afterBlock);
    if (content) return { kind: "notify_only", content };
  }

  return { kind: "unrecognized" };
}

/**
 * Fills the job_accepted notify template from authoritative data only —
 * never from the model, never guessed. A placeholder with no known value is
 * left as a literal "unknown" rather than silently dropped, so a gap in the
 * data source is visible in the delivered message instead of hidden.
 */
export function fillNotifyTemplate(
  template: string,
  fields: { title?: string; description?: string; tokenAmount?: string; tokenSymbol?: string }
): string {
  return template
    .replace(/<title>/g, fields.title ?? "unknown")
    .replace(/<description>/g, fields.description ?? "unknown")
    .replace(/<tokenAmount>/g, fields.tokenAmount ?? "unknown")
    .replace(/<tokenSymbol>/g, fields.tokenSymbol ?? "unknown")
    .replace(/<escrow>/g, "escrow");
}

/**
 * `agent user-notify --content` is executed as an argv array (never a shell
 * string), so an embedded newline cannot inject anything — but the shared
 * `authorizeAction` boundary in system-event-route.ts rejects ANY argument
 * containing `\n` (a deliberately blunt, defense-in-depth rule that applies
 * uniformly to every proposed action regardless of who proposed it). A
 * multi-line notify body must therefore be flattened before it becomes an
 * action argument, not after.
 */
export function flattenForCliArgument(content: string): string {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
}
