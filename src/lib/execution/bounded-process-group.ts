/**
 * The one place a heavy child process is spawned, bounded, deprioritized, and
 * — new in this module — paused so the ASP's liveness proof can refresh.
 *
 * === Lineage ===
 *
 * Incident #22: a heavy child must run at the lowest scheduling priority
 * (`nice 19`) so it never outranks the agent's own liveness calls for CPU.
 *
 * Incident #26/#28: a bounded child must die by PROCESS GROUP, not by
 * `execa`'s own `timeout` (which signals the direct child only) — otherwise a
 * timed-out install/build/test leaves grandchildren reparented to init,
 * accumulating and starving the machine further with every timeout.
 *
 * This module: `nice 19` proved insufficient on its own. Production evidence,
 * 2026-08-07: a single legitimate verification pipeline drove a 1-vCPU Fly
 * machine to load 7–8, and `onchainos agent gate-check` could not complete
 * inside its 300s bound even though it runs at the default (higher) priority
 * — the contention includes memory and process-creation overhead that nice
 * does not arbitrate. The only mechanism that reliably guarantees the
 * gate-check machine headroom is to stop competing for it entirely: PAUSE the
 * heavy child's process group (`SIGSTOP`) while a liveness refresh runs, then
 * `SIGCONT` it — regardless of the refresh's outcome, so nothing is ever left
 * permanently stopped.
 *
 * === Deadline accounting ===
 *
 * A phase intentionally paused for liveness is not phase work; counting that
 * time against the phase's own deadline would make the liveness protection
 * itself the cause of spurious timeouts, worst-case exactly when it is most
 * active. The deadline is therefore EXTENDED by however long a pause actually
 * lasted. This cannot become unbounded: `MAX_TOTAL_YIELD_MS` caps the total
 * extension a single execution may accumulate, so a liveness refresh that
 * never recovers degrades to "this phase ran without further yielding" rather
 * than "this phase can never time out" — every bound in this codebase remains
 * a hard ceiling.
 *
 * === Safety around a stopped process ===
 *
 * A process in the STOPPED state does not act on ordinary signals like
 * SIGTERM until it is resumed; only SIGKILL is guaranteed to terminate a
 * stopped process. So the deadline's own kill path always issues `SIGCONT`
 * immediately before `SIGTERM`/`SIGKILL` — otherwise a job that times out
 * while paused could sit stopped forever, immune to its own deadline.
 */
import os from "node:os";
import { execa } from "execa";
import {
  isLivenessProvenFresh,
  requestLivenessRefresh,
} from "@/lib/okx-runtime/liveness-coordinator";

/**
 * Drops a heavy child to the lowest scheduling priority. Best-effort: an
 * unsupported platform or a child that has already exited must never fail the
 * work that depends on this running.
 */
export function deprioritize(pid: number | undefined, label: string): void {
  if (pid === undefined) return;
  try {
    os.setPriority(pid, 19);
  } catch {
    void label; // renice is advisory; never let it break the pipeline
  }
}

const KILL_GRACE_MS = 5_000;

/**
 * How often the yield ticker checks whether liveness needs the machine.
 * Exported so a regression can pin that this is a bounded, sane cadence
 * rather than a busy loop — the cadence itself is also the backoff for a
 * refresh that keeps failing (see `tick` below).
 */
export const LIVENESS_YIELD_CHECK_INTERVAL_MS = 20_000;

/**
 * Trigger a pause with this much runway left before the proof actually goes
 * stale — enough for one full gate-check attempt (bounded at 300s in
 * production) plus margin, so pausing "early enough" is the normal case
 * rather than a last-second scramble.
 */
export const LIVENESS_YIELD_SAFETY_MARGIN_MS = 300_000;

/**
 * Ceiling on how much a single execution's deadline may be extended by
 * intentional liveness yields. Matches the gate-check's normal refresh
 * cadence (900s) — enough for a genuine refresh cycle or two, not enough to
 * make the phase's own bound meaningless if liveness stays broken throughout.
 */
export const MAX_TOTAL_YIELD_MS = 900_000;

export interface BoundedGroupOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  label: string;
  /** Test seam: disables the liveness-yield ticker so timing tests stay deterministic. */
  yieldForLiveness?: boolean;
  /** Test seam: overrides the tick cadence so pause/resume tests do not wait 20s of real time. */
  yieldCheckIntervalMs?: number;
}

/**
 * Pure deadline-extension arithmetic, extracted so it can be proven correct
 * without racing real OS process scheduling in a test.
 *
 * `pausedTotalMsSoFar` and the returned `pausedTotalMs` track the HONEST total
 * time spent paused, even once the cap stops crediting further extension —
 * "how long did we wait" and "how much of that we protected the deadline for"
 * are different questions, and collapsing them would hide a job that is being
 * silently starved past the cap.
 */
export function extendDeadlineForPause(
  deadlineAtMs: number,
  pausedForMs: number,
  pausedTotalMsSoFar: number,
  maxTotalYieldMs: number = MAX_TOTAL_YIELD_MS
): { deadlineAtMs: number; pausedTotalMs: number } {
  const grantable =
    pausedTotalMsSoFar < maxTotalYieldMs
      ? Math.min(pausedForMs, maxTotalYieldMs - pausedTotalMsSoFar)
      : 0;
  return {
    deadlineAtMs: deadlineAtMs + grantable,
    pausedTotalMs: pausedTotalMsSoFar + pausedForMs,
  };
}

export interface BoundedGroupResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal?: string | null;
  timedOut?: boolean;
  /** Total time this execution spent intentionally paused for a liveness refresh. */
  pausedMs: number;
}

/**
 * Spawns `command`, deprioritizes it, bounds it by process group, and pauses
 * it whenever the ASP's liveness proof needs the machine to refresh.
 *
 * On Windows, `detached` opens a new console rather than a killable group, so
 * neither the group-kill nor the pause/resume mechanism is safe there;
 * `execa`'s own per-child `timeout` is used instead and liveness yielding is
 * skipped. Every production Fly machine is Linux, so this only narrows
 * behaviour in local Windows development.
 */
export async function runBoundedProcessGroup(
  command: string[],
  options: BoundedGroupOptions
): Promise<BoundedGroupResult> {
  const useProcessGroup = process.platform !== "win32";
  const yieldEnabled = useProcessGroup && options.yieldForLiveness !== false;

  const child = execa(command[0], command.slice(1), {
    cwd: options.cwd,
    env: options.env,
    reject: false,
    detached: useProcessGroup,
    timeout: useProcessGroup ? undefined : options.timeoutMs,
  });

  deprioritize(child.pid, options.label);

  let timedOut = false;
  let paused = false;
  let pausedAtMs = 0;
  let pausedTotalMs = 0;
  let deadlineAtMs = Date.now() + options.timeoutMs;
  let deadlineTimer: NodeJS.Timeout | undefined;
  let yieldTimer: NodeJS.Timeout | undefined;
  let stopped = false;

  const killGroup = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try {
      if (useProcessGroup) {
        // A stopped group does not act on SIGTERM/SIGKILL-adjacent signals
        // until resumed. Always resume first so termination is guaranteed to
        // actually take effect, even if this fires while paused.
        try {
          process.kill(-child.pid, "SIGCONT");
        } catch {
          /* not stopped, or already exited */
        }
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* already exited */
      }
    }
  };

  const armDeadline = () => {
    if (!useProcessGroup) return;
    if (deadlineTimer) clearTimeout(deadlineTimer);
    const remaining = Math.max(0, deadlineAtMs - Date.now());
    deadlineTimer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      const killTimer = setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS);
      killTimer.unref?.();
    }, remaining);
    deadlineTimer.unref?.();
  };
  armDeadline();

  const resumeIfPaused = () => {
    if (!paused || child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGCONT");
    } catch {
      /* already exited */
    }
    paused = false;
    const pausedFor = Date.now() - pausedAtMs;
    const extended = extendDeadlineForPause(deadlineAtMs, pausedFor, pausedTotalMs);
    deadlineAtMs = extended.deadlineAtMs;
    pausedTotalMs = extended.pausedTotalMs;
    armDeadline();
  };

  const pauseForLiveness = (): boolean => {
    if (paused || child.pid === undefined) return false;
    if (pausedTotalMs >= MAX_TOTAL_YIELD_MS) return false;
    try {
      process.kill(-child.pid, "SIGSTOP");
      paused = true;
      pausedAtMs = Date.now();
      return true;
    } catch {
      return false;
    }
  };

  const checkIntervalMs = options.yieldCheckIntervalMs ?? LIVENESS_YIELD_CHECK_INTERVAL_MS;
  const scheduleTick = () => {
    if (stopped) return;
    yieldTimer = setTimeout(tick, checkIntervalMs);
    // Never keeps the process alive purely to run this check.
    yieldTimer.unref?.();
  };

  /**
   * One tick: if the liveness proof will not survive another
   * `LIVENESS_YIELD_CHECK_INTERVAL_MS` unattended, pause the child, request a
   * refresh, and resume — whatever the refresh's outcome. A refresh that
   * fails is retried on the NEXT tick rather than looped immediately, so a
   * broken gate-check cannot turn this into a busy loop; the cadence itself
   * is the backoff.
   */
  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      if (!isLivenessProvenFresh(LIVENESS_YIELD_SAFETY_MARGIN_MS)) {
        if (pauseForLiveness()) {
          await requestLivenessRefresh();
        }
      }
    } finally {
      resumeIfPaused();
      scheduleTick();
    }
  }
  if (yieldEnabled) scheduleTick();

  try {
    const result = await child;
    return {
      exitCode: result.exitCode ?? null,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      signal: result.signal ?? null,
      timedOut: timedOut || result.timedOut === true,
      pausedMs: pausedTotalMs,
    };
  } finally {
    stopped = true;
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (yieldTimer) clearTimeout(yieldTimer);
    // A child that exited while genuinely paused (should not happen — a
    // stopped process cannot exit — but a race between resume and exit is
    // cheap to guard) must never be left stopped once we stop watching it.
    resumeIfPaused();
  }
}
