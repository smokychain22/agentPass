/**
 * === Incident #29: "machine-wide" was only "process-wide" ===
 *
 * Discovered live on repodiet-agent-9636, 2026-08-07, running the ROW 8
 * production PR proof: `scripts/verify-production-cleanup-pr.ts` runs as its
 * OWN standalone Node process, separate from the seller runtime
 * (`scripts/repodiet-seller-runtime.ts`). `runExclusiveHeavyJob`'s single
 * slot (`heavy-job-limiter.ts`'s module-level `inFlight`) is in-process
 * memory — it cannot see, and therefore cannot exclude, a heavy job running
 * in a DIFFERENT process. With the funded job's own retry running inside the
 * seller runtime and the proof script running standalone, both acquired the
 * "single machine-wide slot" independently and ran concurrently:
 *
 *   pid=1862 next build     (funded job, reparented to init — a real orphan)
 *   pid=2128 npm install    (funded job, patched phase)
 *   pid=2203 npm install    (the proof script, its own process tree)
 *   LOAD=10.89   MemAvailable=231796 kB on a 2015836 kB / zero-swap machine
 *
 * The liveness-first scheduler (bounded-process-group.ts) still held the
 * heartbeat through this — every heavy child, in either process, still gets
 * paused for a gate-check refresh — so this was not a repeat of the
 * heartbeat-withholding incidents. But two heavy pipelines sharing a 2 GB
 * box with zero swap is exactly the condition Incident #22's docstring
 * already named as "enough on its own to reach the OOM killer", and admission
 * control that only sees its own process is not admission control for the
 * claim this module makes.
 *
 * === The fix ===
 *
 * A lock FILE on the shared runtime root (`resolveRuntimeRoot()` — the same
 * value every process on this Machine already resolves to, because it comes
 * from the same `REPODIET_OKX_RUNTIME_ROOT`/`XDG_DATA_HOME` environment every
 * process shares) is visible cross-process where memory is not. It layers on
 * top of the existing in-memory guard rather than replacing it: the in-memory
 * check stays the fast, zero-I/O path for the common same-process case, and
 * this is the cross-process backstop.
 *
 * Staleness is judged by "no touch within STALE_AFTER_MS", not by absolute
 * age — a genuinely long but healthy job keeps touching its own lock (see
 * `touchCrossProcessLock`, called periodically by `runExclusiveHeavyJob`
 * while `fn` runs), so it is never mistaken for abandoned. A process that
 * crashed or was killed stops touching immediately, so its lock goes stale on
 * its own without needing that process to run any cleanup code.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveRuntimeRoot } from "./runtime-root";

/**
 * Generous on purpose: must exceed the longest legitimate gap between two
 * touches, which is bounded by the heavy-job timeout PLUS the maximum total
 * liveness-yield extension a single execution may accumulate (900s) — the two
 * ways a healthy job can legitimately go quiet for a while.
 */
const STALE_AFTER_MS = 45 * 60_000;

interface LockFileContents {
  label: string;
  pid: number;
  /**
   * `/proc/<pid>/stat`'s start-time field (ticks since boot) at acquire time —
   * see Incident #31. `undefined` on non-Linux, where pid reuse across a
   * restart cannot be disambiguated and the plain pid-alive check is all
   * that's available.
   */
  pidStartTimeTicks?: number;
  startedAtMs: number;
  updatedAtMs: number;
  draining: boolean;
}

let lockDirOverride: string | undefined;
let bootAtMsOverride: number | undefined;

/**
 * Test seam: real system uptime cannot be faked cross-platform, so tests
 * inject a boot time directly rather than exercising `os.uptime()`.
 */
export function setBootAtMsForTests(bootAtMs: number | undefined): void {
  bootAtMsOverride = bootAtMs;
}

function lockFilePath(): string {
  /**
   * The env var exists so a REAL child process spawned by a test — not just
   * an in-process call — can be pointed at the same isolated directory as its
   * parent. `lockDirOverride` alone cannot do this: it is in-memory state,
   * and a spawned child does not inherit another process's memory, which is
   * precisely the property Incident #29 was about.
   */
  const dir =
    lockDirOverride ?? process.env.REPODIET_HEAVY_JOB_LOCK_DIR_FOR_TEST?.trim() ?? resolveRuntimeRoot();
  return path.join(dir, "heavy-job.lock");
}

/** Test seam: points the lock at an isolated directory so tests never touch a real runtime root or each other. */
export function setHeavyJobLockDirForTests(dir: string | undefined): void {
  lockDirOverride = dir;
}

/**
 * True if `pid` is alive and this process can at least ATTEMPT to signal it.
 * `EPERM` (exists, owned by someone else) still means alive; only `ESRCH`
 * means gone. Any other error is treated as "cannot tell" and therefore NOT
 * alive — a lock this process cannot even query for liveness must not be
 * trusted to still be held.
 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * === Incident #31: a reused pid is not the same process ===
 *
 * Discovered live on repodiet-agent-9636, 2026-08-08, right after the
 * Incident #30 deploy restarted the machine: a lock created at 12:02:24Z by
 * the FUNDED job, last touched at 12:37:25Z, survived a restart at 12:42:37Z
 * — because the OLD owning process died with the container, but the NEW
 * seller runtime happened to be assigned the exact SAME pid (729) on reboot.
 * `pidAlive(729)` then answered "yes" truthfully — the new process genuinely
 * is alive — while asking the wrong question: whether THAT PARTICULAR
 * process, the one that actually wrote the lock, still exists. It does not.
 * The result was a lock that would have silently blocked all heavy work
 * (both the funded job's own future retries and any other caller) for up to
 * `STALE_AFTER_MS` after every single restart whose reused low pid happened
 * to collide with the file's recorded owner — LOAD was 0.71 with zero real
 * npm/build processes running, yet the lock still read as legitimately held.
 *
 * `/proc/<pid>/stat`'s start-time field (ticks since boot) disambiguates a
 * pid NUMBER from a pid IDENTITY: two different processes can share a
 * number, but never a (pid, start-time) pair on the same boot. Recorded at
 * acquire time and re-read at every staleness check; a mismatch — or the
 * current process at that pid having no start time the kernel will report,
 * i.e. it does not exist — means stale, full stop, regardless of what
 * `pidAlive` alone would have said.
 *
 * Non-Linux (this field lives under `/proc`, so Windows and any sandboxed
 * environment without a real procfs) falls back to the pid-alive-only check
 * this replaces — no regression there, since that platform never had the
 * disambiguation to begin with.
 */
function processStartTimeTicks(pid: number): number | undefined {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    // `comm` (the second field) is parenthesized and may itself contain
    // spaces or parentheses, so the safe split point is the LAST ')' — every
    // field after it is fixed-format and space-separated. start-time is the
    // 20th of those trailing fields (index 19), matching the `stat(5)` layout
    // already relied on elsewhere in this codebase (bounded-process-group.ts,
    // repodiet-seller-runtime.ts).
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2);
    const ticks = Number(afterComm.split(" ")[19]);
    return Number.isFinite(ticks) ? ticks : undefined;
  } catch {
    return undefined;
  }
}

/**
 * True only if `pid` is alive AND is provably the SAME process instance that
 * `recordedStartTimeTicks` was captured from — see Incident #31.
 *
 * `recordedStartTimeTicks === undefined` means the lock predates this field
 * (an older record, or written from a non-Linux process) — falls back to the
 * plain pid-alive check rather than treating every legacy record as stale.
 */
function pidIsSameProcess(pid: number, recordedStartTimeTicks: number | undefined): boolean {
  if (!pidAlive(pid)) return false;
  if (recordedStartTimeTicks === undefined) return true;
  const currentStartTimeTicks = processStartTimeTicks(pid);
  // Unreadable /proc (non-Linux, or the process just exited) — cannot prove
  // identity, so this must NOT be trusted as the same process.
  if (currentStartTimeTicks === undefined) return false;
  return currentStartTimeTicks === recordedStartTimeTicks;
}

function readLock(file: string): LockFileContents | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.pid === "number" &&
      typeof parsed.updatedAtMs === "number"
    ) {
      return parsed as LockFileContents;
    }
    return undefined;
  } catch {
    return undefined; // absent, unreadable, or corrupt — all read as "no usable lock"
  }
}

/**
 * === Incident #32: the Incident #31 fix could not disambiguate its OWN
 * deployment transition ===
 *
 * Discovered live on repodiet-agent-9636, 2026-08-08, on the FIRST restart
 * after Incident #31 shipped — the exact scenario #31 exists for. A lock
 * written by the PREVIOUS deploy (which did not yet have `pidStartTimeTicks`
 * at all — that field did not exist in that code) survived the restart. The
 * new seller runtime was again assigned the reused pid. `pidIsSameProcess`
 * correctly has a backward-compatible fallback for "this record predates the
 * field" — but that fallback IS the plain pid-alive check, which is exactly
 * the check Incident #31 proved insufficient. A legacy record can therefore
 * never be told apart from a genuine same-instance record using only what the
 * record itself contains, because a legacy record and a reused-pid record
 * look byte-for-byte identical: neither has the field.
 *
 * The fix does not depend on the record's own fields at all. `os.uptime()` is
 * the KERNEL's own answer to "how long has this machine been up", so
 * `Date.now() - os.uptime() * 1000` is this boot's start time — and no
 * process, however it was written, could have touched a lock file before its
 * own machine finished booting. If the lock's last touch predates the
 * current boot, it is unconditionally stale, independent of pid, start-time
 * ticks, or whether the writer even knew this field existed.
 */
function isStale(existing: LockFileContents | undefined, nowMs: number): boolean {
  if (!existing) return true;
  if (nowMs - existing.updatedAtMs > STALE_AFTER_MS) return true;
  const bootAtMs = bootAtMsOverride ?? nowMs - os.uptime() * 1000;
  if (existing.updatedAtMs < bootAtMs) return true;
  return !pidIsSameProcess(existing.pid, existing.pidStartTimeTicks);
}

function writeLock(file: string, contents: LockFileContents): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(contents));
}

export type LockAcquireResult =
  | { ok: true }
  | { ok: false; reason: string; heldByLabel?: string; draining?: boolean };

/**
 * Attempts to take the cross-process heavy-job lock. `fs.openSync(..., "wx")`
 * is an atomic exclusive-create on every platform this runs on, which is the
 * actual mutual-exclusion primitive; everything else here is staleness
 * reclamation around it.
 */
export function tryAcquireCrossProcessLock(label: string, nowMs: number = Date.now()): LockAcquireResult {
  const file = lockFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const attempt = (): LockAcquireResult | undefined => {
    try {
      const fd = fs.openSync(file, "wx");
      try {
        fs.writeFileSync(
          fd,
          JSON.stringify({
            label,
            pid: process.pid,
            pidStartTimeTicks: processStartTimeTicks(process.pid),
            startedAtMs: nowMs,
            updatedAtMs: nowMs,
            draining: false,
          } satisfies LockFileContents)
        );
      } finally {
        fs.closeSync(fd);
      }
      return { ok: true };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        // Any other filesystem failure (permissions, read-only volume, disk
        // full) fails CLOSED: refuse admission rather than proceed with no
        // cross-process protection, which is the exact hole this exists to
        // close.
        return { ok: false, reason: `heavy-job lock unavailable: ${(err as Error).message}` };
      }
      return undefined; // EEXIST — fall through to staleness handling below
    }
  };

  const first = attempt();
  if (first) return first;

  const existing = readLock(file);
  if (!isStale(existing, nowMs)) {
    return {
      ok: false,
      reason: `another process (${existing?.label ?? "unknown"}, pid ${existing?.pid ?? "?"}) holds the cross-process heavy-job lock`,
      heldByLabel: existing?.label,
      draining: existing?.draining,
    };
  }

  // Stale: reclaim. A genuine race between two reclaimers here is bounded and
  // self-healing — whichever `wx` create wins is the new legitimate holder,
  // and the loser's very next admission attempt (its own retry, on its own
  // backoff) will correctly see a fresh, non-stale lock and back off. That is
  // the same replayable-refusal contract every other admission failure in
  // this module already has.
  try {
    fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
  const second = attempt();
  if (second) return second;
  return {
    ok: false,
    reason: "lost the race to reclaim a stale heavy-job lock; retry on backoff",
  };
}

/** Extends the lock's staleness window. Called periodically while `fn` runs. */
export function touchCrossProcessLock(nowMs: number = Date.now()): void {
  const file = lockFilePath();
  const existing = readLock(file);
  if (!existing || existing.pid !== process.pid) return; // not ours to touch
  writeLock(file, { ...existing, updatedAtMs: nowMs });
}

/** Marks the lock as draining — held, but by an abandoned-by-its-caller job. */
export function markCrossProcessLockDraining(nowMs: number = Date.now()): void {
  const file = lockFilePath();
  const existing = readLock(file);
  if (!existing || existing.pid !== process.pid) return;
  writeLock(file, { ...existing, draining: true, updatedAtMs: nowMs });
}

/** Releases the lock — but only if it is still genuinely ours. */
export function releaseCrossProcessLock(): void {
  const file = lockFilePath();
  const existing = readLock(file);
  if (!existing || existing.pid !== process.pid) return;
  try {
    fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
}
