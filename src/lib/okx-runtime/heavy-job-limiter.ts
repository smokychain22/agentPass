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
import { isLivenessProvenFresh } from "@/lib/okx-runtime/liveness-coordinator";
import {
  tryAcquireCrossProcessLock,
  touchCrossProcessLock,
  markCrossProcessLockDraining,
  releaseCrossProcessLock,
} from "@/lib/okx-runtime/heavy-job-cross-process-lock";

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
export const PRODUCTION_HEAVY_JOB_TIMEOUT_MS = 1_800_000;

/** Resolved per call (Incident #27) so a test can inject without import-order games. */
export function heavyJobTimeoutMs(): number {
  const o = Number(process.env.REPODIET_HEAVY_JOB_TIMEOUT_MS);
  return Number.isFinite(o) && o > 0 ? o : PRODUCTION_HEAVY_JOB_TIMEOUT_MS;
}

export class HeavyJobRejected extends Error {
  constructor(
    readonly code:
      | "heavy_job_already_running"
      | "heavy_job_timeout"
      | "heavy_job_liveness_unproven",
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
 *
 * `draining` marks a slot whose CALLER has given up but whose WORK is still
 * running — see the timeout discussion in `runExclusiveHeavyJob`.
 */
interface HeavyJobSlot {
  label: string;
  startedAtMs: number;
  draining: boolean;
}

let inFlight: HeavyJobSlot | undefined;

/** Read-only view for logging and tests. */
export function currentHeavyJob(): HeavyJobSlot | undefined {
  return inFlight;
}

/** Test seam — production never calls this. */
export function resetHeavyJobLimiterForTests(): void {
  inFlight = undefined;
  releaseCrossProcessLock();
}

/**
 * Runs `fn` as THE heavy job for this process, or refuses.
 *
 * Refuses immediately (never queues) when another heavy job holds the slot:
 * queueing would let arrivals pile up behind a job that is already too slow,
 * which is the pathology this exists to prevent. The caller's retry policy is
 * the queue.
 *
 * The timeout bounds the caller's WAIT. It cannot itself terminate work already
 * running inside `fn` — `fn` owns its own subprocesses and is responsible for
 * killing them (see `runBoundedInstall` in workspace-install.ts, which kills the
 * whole process group on its own deadline). The abort signal is passed to `fn`
 * so a cooperating pipeline can stop early.
 *
 * === Incident #28: releasing the slot on timeout MANUFACTURED concurrency ===
 *
 * This function previously cleared `inFlight` in a `finally`, on the reasoning
 * that "holding the slot for a job we have already stopped waiting on would
 * deadlock every future heavy job". That reasoning was wrong, and it inverted
 * the guarantee this module exists to provide.
 *
 * Observed on repodiet-agent-9636: a cleanup hit its bound, the event was
 * recorded `retryable_failure` / `heavy_job_timeout` — correctly — and the slot
 * was freed. But the `npm install` beneath it was still running. The retry then
 * found the slot empty, took it, and started a SECOND install. Two concurrent
 * installs on a 2 GB / 1-vCPU box, each cycle adding another orphan:
 *
 *   pid=15134 nice=19 age=102s :: npm install
 *   pid=15214 nice=19 age=28s  :: npm install
 *
 * `nice 19` correctly kept the runtime itself schedulable, but nice arbitrates
 * CPU only — it does nothing about memory or IO. Load average sat near 8 on one
 * vCPU, `onchainos agent gate-check` could not finish inside its 300s ceiling,
 * the proof went `unproven`, and the heartbeat was withheld 125 times running.
 * The admission control designed to prevent concurrent heavy work was itself
 * the thing creating it.
 *
 * The fix separates the two lifetimes that were wrongly fused:
 *
 *   - the CALLER's wait ends at the timeout, so the event still fails fast,
 *     stays unacknowledged, and is retried on the existing backoff;
 *   - the SLOT is held until `fn` actually settles, so no retry can start a
 *     second install while the first is still alive.
 *
 * This cannot deadlock the machine permanently: everything `fn` runs is itself
 * bounded and process-group-killed (install 600s, per check 300s, verification
 * total 1500s), so a drained slot is released once those inner deadlines fire.
 * A job we have stopped waiting on keeps the slot exactly as long as it keeps
 * consuming the machine — which is the honest accounting.
 */
export async function runExclusiveHeavyJob<T>(
  label: string,
  fn: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs?: number; nowMs?: () => number } = {}
): Promise<T> {
  const now = options.nowMs ?? Date.now;

  /**
   * === Admission half of the liveness-first scheduler ===
   *
   * Necessary but NOT sufficient on its own: production evidence showed the
   * agent proven healthy immediately before a heavy job started and only
   * degrading DURING it. The other half — yielding while work is already
   * running — lives in bounded-process-group.ts, which every heavy child
   * spawned by `fn` goes through. This half only stops a NEW job from being
   * admitted onto a machine whose liveness is already unproven; it says
   * nothing about a job already in flight.
   *
   * Zero safety margin here deliberately: this is a point-in-time check
   * ("can we start right now"), not a forecast. Checked before the `inFlight`
   * guard so an unproven machine refuses new work regardless of whether the
   * single slot happens to be free.
   */
  if (!isLivenessProvenFresh(0)) {
    throw new HeavyJobRejected(
      "heavy_job_liveness_unproven",
      `refusing to start ${label}: the ASP's liveness proof is not currently fresh; retry once the gate proof recovers`
    );
  }

  if (inFlight) {
    const heldMs = now() - inFlight.startedAtMs;
    throw new HeavyJobRejected(
      "heavy_job_already_running",
      inFlight.draining
        ? `another heavy repository execution (${inFlight.label}) exceeded its bound ${heldMs}ms ago and its subprocesses are still draining; refusing to run ${label} on top of work that is still consuming this machine`
        : `another heavy repository execution (${inFlight.label}) has held this machine's single heavy slot for ${heldMs}ms; refusing to run ${label} concurrently`
    );
  }

  /**
   * === Incident #29: the in-memory slot above is only PROCESS-wide ===
   *
   * Discovered running the ROW 8 production proof: `verify-production-
   * cleanup-pr.ts` runs as its own standalone process, separate from the
   * seller runtime. `inFlight` is module-level memory, invisible across a
   * process boundary — both processes independently acquired "the machine's
   * single slot" and ran concurrently (two `npm install`s plus a `next
   * build`, load 10.89, 231 MB available on a 2 GB / zero-swap machine).
   *
   * This lock file is the cross-process backstop — see
   * heavy-job-cross-process-lock.ts. It composes with, rather than replaces,
   * the in-memory guard above: memory stays the free, instant path for the
   * common same-process case, and the file is what a DIFFERENT process can
   * actually observe.
   */
  const crossProcess = tryAcquireCrossProcessLock(label, now());
  if (!crossProcess.ok) {
    throw new HeavyJobRejected(
      "heavy_job_already_running",
      crossProcess.draining
        ? `${crossProcess.reason}, and its subprocesses are still draining; refusing to run ${label} on top of work that is still consuming this machine`
        : `${crossProcess.reason}; refusing to run ${label} concurrently`
    );
  }

  const timeoutMs = options.timeoutMs ?? heavyJobTimeoutMs();
  const slot: HeavyJobSlot = { label, startedAtMs: now(), draining: false };
  inFlight = slot;
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  // Keeps the cross-process lock from going stale under a long but healthy
  // job. Well inside STALE_AFTER_MS (45 min) so a single missed tick under
  // load is harmless; unref'd so it can never keep this process alive on its
  // own, and always cleared below regardless of how `work` settles.
  const touchTimer = setInterval(() => touchCrossProcessLock(), 5 * 60_000);
  touchTimer.unref?.();

  const work = fn(controller.signal);

  /**
   * The slot's release is bound to the WORK, not to the caller's wait. The
   * empty handlers also mean that a rejection arriving after the race has
   * already settled is observed here rather than surfacing as an unhandled
   * rejection — which, under Node's default, would take the runtime down.
   */
  void work.then(
    () => {},
    () => {}
  ).finally(() => {
    if (inFlight === slot) inFlight = undefined;
    clearInterval(touchTimer);
    releaseCrossProcessLock();
  });

  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        // Deliberately NOT unref'd. An unref'd timer is skipped entirely when
        // nothing else holds the event loop open, which would make the bound
        // silently optional — the one property this function exists to
        // provide. It is always cleared in the `finally` below, so it can
        // never keep the process alive past the job it is bounding.
        timer = setTimeout(() => {
          slot.draining = true;
          markCrossProcessLockDraining();
          controller.abort();
          reject(
            new HeavyJobRejected(
              "heavy_job_timeout",
              `${label} exceeded its ${timeoutMs}ms bound and was abandoned; the event stays pending and is retried on backoff, and the heavy slot stays held until its subprocesses finish draining`
            )
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    // NOT released here — see the Incident #28 note above. Release is driven by
    // `work` settling, which is the only event that means the machine is free.
  }
}
