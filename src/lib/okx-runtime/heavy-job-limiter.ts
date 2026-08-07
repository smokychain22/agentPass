/**
 * Machine-wide admission control for expensive repository work.
 *
 * === What "expensive" means here, measured rather than assumed ===
 *
 * Exactly one step in the system-event path does heavy work:
 * `createCleanupPullRequest`, reached from `createDeterministicTurn`'s
 * `job_accepted_execute` branch. It clones a repository, runs a full dependency
 * install (up to 4 attempts × 180s), runs the analyzer, then runs the
 * verification pipeline — a baseline install AND a patched install. On the
 * production Machine (shared-cpu-1x, 2 GB) that is enough on its own to drive
 * the box into contention: the observed failures include SIGKILL/exit 137 from
 * the OOM killer, which `describeProcessTermination` exists specifically to
 * name.
 *
 * Everything else on the same box is cheap and must stay responsive while that
 * runs — most importantly the A2A conversation path (XMTP → okx-a2a daemon →
 * OpenClaw → repodiet-a2a-bridge → HTTPS), which is what answers a marketplace
 * reviewer and never touches this module.
 *
 * === Why admission control rather than "just make it faster" ===
 *
 * Incident #18 established that a failing heavy job replayed at full poll speed
 * and, on restart, immediately — so the machine could be running the heavy
 * pipeline essentially continuously. The per-event quarantine
 * (`retryAfterIso`) fixes the CADENCE. This fixes the CONCURRENCY and the
 * DURATION, which are separate failure modes:
 *
 *   - Concurrency: the poll loop and the open-job sweep run on independent
 *     timers, and recovery walks every pending event in turn. Nothing
 *     structurally prevented two heavy runs from overlapping, and two
 *     concurrent dependency installs on a 2 GB box is an OOM, not a slowdown.
 *   - Duration: no bound existed above the individual subprocess timeouts, so a
 *     pipeline that stalled between them could occupy the machine indefinitely
 *     while still looking alive.
 *
 * === Failure semantics ===
 *
 * Both refusals are REPLAYABLE, never terminal. They return through the same
 * `{ ok: false, status: undefined }` path the executor already treats as
 * `internal_failure_retryable`, so the event keeps its ledger record, keeps its
 * envelope, and is retried later on the existing bounded backoff. Nothing here
 * acknowledges, delivers, settles or discards anything — a busy or slow machine
 * must never be able to decide a funded job's outcome.
 */

/**
 * Wall-clock ceiling for one heavy repository execution.
 *
 * === Incident #26: the ceiling has to be bigger than the work it bounds ===
 *
 * The bounds below this one form a hierarchy, and it only holds if each layer
 * is larger than the sum of what it contains. A full cleanup is a BASELINE
 * install plus its checks, then a PATCHED install plus its checks:
 *
 *   install            600s   (nice 19, npm capped to 3 sockets)
 *   per check          300s   (`next build` is the heaviest)
 *   verification total 1500s
 *   heavy job          1800s  ← must exceed the verification total
 *   event execution    2400s  ← must exceed the heavy job
 *
 * Raising the inner bounds to what this machine can actually achieve (Incident
 * #26) without raising these two would simply move the failure outwards: the
 * install would finish and the job would be abandoned anyway.
 *
 * These are still hard ceilings. Concurrency is still one heavy job at a time,
 * cadence is still governed by the per-job quarantine, and a timed-out job is
 * still abandoned and left replayable rather than acknowledged.
 */
export const HEAVY_JOB_TIMEOUT_MS = Number(
  process.env.REPODIET_HEAVY_JOB_TIMEOUT_MS || 1_800_000
);

export class HeavyJobRejected extends Error {
  constructor(
    readonly code: "heavy_job_already_running" | "heavy_job_timeout",
    message: string
  ) {
    super(message);
    this.name = "HeavyJobRejected";
  }
}

/**
 * Process-wide, deliberately not per-job: the constraint being enforced is the
 * MACHINE's memory and single shared vCPU, which two different jobs contend
 * over exactly as much as two attempts at the same job would.
 */
let inFlight: { label: string; startedAtMs: number } | undefined;

/** Read-only view for logging and tests. */
export function currentHeavyJob(): { label: string; startedAtMs: number } | undefined {
  return inFlight;
}

/** Test seam — production never calls this. */
export function resetHeavyJobLimiterForTests(): void {
  inFlight = undefined;
}

/**
 * Runs `fn` as THE heavy job for this process, or refuses.
 *
 * Refuses immediately (never queues) when another heavy job holds the slot:
 * queueing would let arrivals pile up behind a job that is already too slow,
 * which is the pathology this exists to prevent. The caller's retry policy is
 * the queue.
 *
 * The timeout bounds the caller's WAIT, and cannot itself terminate work
 * already running inside `fn` — `fn` owns its own subprocesses and is
 * responsible for killing them (see `runBounded` in workspace-install.ts, which
 * kills the whole process group). The slot is released on timeout so a wedged
 * job cannot hold the machine hostage forever, and the abort signal is passed
 * to `fn` so a cooperating pipeline can stop early.
 */
export async function runExclusiveHeavyJob<T>(
  label: string,
  fn: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs?: number; nowMs?: () => number } = {}
): Promise<T> {
  const now = options.nowMs ?? Date.now;
  if (inFlight) {
    throw new HeavyJobRejected(
      "heavy_job_already_running",
      `another heavy repository execution (${inFlight.label}) has held this machine's single heavy slot for ${
        now() - inFlight.startedAtMs
      }ms; refusing to run ${label} concurrently`
    );
  }

  const timeoutMs = options.timeoutMs ?? HEAVY_JOB_TIMEOUT_MS;
  inFlight = { label, startedAtMs: now() };
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<never>((_resolve, reject) => {
        // Deliberately NOT unref'd. An unref'd timer is skipped entirely when
        // nothing else holds the event loop open, which would make the bound
        // silently optional — the one property this function exists to
        // provide. It is always cleared in the `finally` below, so it can
        // never keep the process alive past the job it is bounding.
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new HeavyJobRejected(
              "heavy_job_timeout",
              `${label} exceeded its ${timeoutMs}ms bound and was abandoned; the event stays pending and is retried on backoff`
            )
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    // Released even on timeout: holding the slot for a job we have already
    // stopped waiting on would deadlock every future heavy job.
    inFlight = undefined;
  }
}
