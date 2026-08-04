import fs from "node:fs";
import path from "node:path";

export type OkxRuntimeRole = "buyer" | "seller";

export interface OkxRuntimeIdentity {
  role: OkxRuntimeRole;
  agentId: "10466" | "9636";
  walletAddress: string;
}

/**
 * The two production runtime identities.
 *
 * The buyer entry previously named Agent 5295 and carried the SELLER's wallet
 * address. Both were wrong, and neither was cosmetic:
 * `buildIsolatedRuntimeEnv` exports `REPODIET_OKX_AGENT_ID` and
 * `REPODIET_OKX_WALLET_ADDRESS` from whichever identity it is given, so
 * starting the buyer role would have run it under a superseded agent id and
 * told it the seller's wallet was its own.
 *
 * `getRuntimePaths` derives the data directory from `agentId`, so this also
 * moves the buyer root from `buyer-5295` to `buyer-10466`. Verified safe on
 * the production volume: only `seller-9636` exists, so no buyer state is
 * orphaned by the rename.
 */
export const OKX_RUNTIME_IDENTITIES: Record<OkxRuntimeRole, OkxRuntimeIdentity> = {
  buyer: {
    role: "buyer",
    agentId: "10466",
    walletAddress: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
  },
  seller: {
    role: "seller",
    agentId: "9636",
    walletAddress: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
  },
};

export interface OkxRuntimePaths {
  root: string;
  home: string;
  config: string;
  data: string;
  logs: string;
  pidFile: string;
  eventStore: string;
  decisionStore: string;
  jobStore: string;
}

export function getRuntimePaths(baseDirectory: string, role: OkxRuntimeRole): OkxRuntimePaths {
  const identity = OKX_RUNTIME_IDENTITIES[role];
  const root = path.resolve(baseDirectory, `${role}-${identity.agentId}`);
  return {
    root,
    home: path.join(root, "home"),
    config: path.join(root, "config"),
    data: path.join(root, "data"),
    logs: path.join(root, "logs"),
    pidFile: path.join(root, "runtime.pid"),
    eventStore: path.join(root, "data", "events.json"),
    decisionStore: path.join(root, "data", "decisions.json"),
    jobStore: path.join(root, "data", "jobs.json"),
  };
}

export function ensureRuntimeLayout(paths: OkxRuntimePaths): void {
  for (const directory of [paths.root, paths.home, paths.config, paths.data, paths.logs]) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

export function buildIsolatedRuntimeEnv(
  base: NodeJS.ProcessEnv,
  paths: OkxRuntimePaths,
  identity: OkxRuntimeIdentity
): NodeJS.ProcessEnv {
  return {
    ...base,
    HOME: paths.home,
    USERPROFILE: paths.home,
    XDG_CONFIG_HOME: paths.config,
    XDG_DATA_HOME: paths.data,
    ONCHAINOS_HOME: path.join(paths.home, ".onchainos"),
    OKX_AGENT_TASK_HOME: path.join(paths.home, ".okx-agent-task"),
    REPODIET_OKX_RUNTIME_ROLE: identity.role,
    REPODIET_OKX_AGENT_ID: identity.agentId,
    REPODIET_OKX_WALLET_ADDRESS: identity.walletAddress,
    REPODIET_OKX_EVENT_STORE: paths.eventStore,
    REPODIET_OKX_DECISION_STORE: paths.decisionStore,
    REPODIET_OKX_JOB_STORE: paths.jobStore,
  };
}

/**
 * `/proc/<pid>/stat`'s field 22 ("starttime", clock ticks since boot) —
 * parsed by finding the LAST ")" (the kernel-supplied `comm` field is
 * parenthesized and may itself contain spaces or parens, so a naive
 * whitespace split from the start would misalign every later field).
 * Returns undefined when `/proc` is unavailable (any non-Linux host,
 * e.g. local Windows development) or the pid has already exited.
 */
function readProcessStartTime(pid: number): string | undefined {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2).trim();
    const fields = afterComm.split(/\s+/);
    // fields[0] is state (stat field 3); starttime is stat field 22, i.e. index 19 here.
    return fields[19];
  } catch {
    return undefined;
  }
}

interface PidFileContents {
  pid: number;
  /** /proc/<pid>/stat's own starttime at the moment this file was written — see readProcessStartTime. Absent when /proc was unavailable. */
  startTime?: string;
}

function parsePidFileContents(raw: string): PidFileContents | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Legacy/plain format: a bare PID with nothing else — still accepted, just
  // without the stronger start-time check below.
  if (/^\d+$/.test(trimmed)) {
    const pid = Number(trimmed);
    return Number.isSafeInteger(pid) && pid > 0 ? { pid } : undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as Partial<PidFileContents>;
    if (typeof parsed.pid !== "number" || !Number.isSafeInteger(parsed.pid) || parsed.pid <= 0) return undefined;
    return { pid: parsed.pid, startTime: typeof parsed.startTime === "string" ? parsed.startTime : undefined };
  } catch {
    return undefined;
  }
}

/**
 * Proves a recorded PID is genuinely still the SAME process this lock file
 * was written for — not merely that some process now holds that PID number.
 *
 * === Real production incident this fixes ===
 * A container reboot resets the kernel's PID counter, so early-boot PIDs
 * are drawn from a small, low, largely deterministic range every time.
 * Live on repodiet-agent-9636: after a Fly deploy restarted the Machine, a
 * fresh boot's `openclaw-gateway` child happened to land on the exact same
 * PID (724) a PREVIOUS boot's seller-runtime had recorded in this
 * persisted lock file — `process.kill(pid, 0)` alone cannot tell these
 * apart, since it only proves "a process with this PID exists right now",
 * not "it is the same process". The false positive made every subsequent
 * boot attempt refuse to start ("another_seller_runtime_is_already_live"),
 * exhausting the Machine's full restart budget and leaving it stopped.
 *
 * Fix: pair the PID with the OS's own process start time
 * (`/proc/<pid>/stat` field 22, clock ticks since boot — read once when the
 * lock is written, re-read and compared on every check). A PID reused by a
 * genuinely different process will, for all practical purposes, never
 * share the exact same start-time tick as the original — the same
 * technique real init systems and process supervisors use to guard against
 * this exact PID-reuse race. Degrades to the plain liveness check alone
 * when `/proc` is unavailable (non-Linux) or no start time was recorded
 * (an older lock file written before this fix) — never a regression from
 * previous behavior, only a strengthening of it.
 */
function isRecordedProcessStillTheSameOne(contents: PidFileContents): boolean {
  if (!contents.startTime) return true; // nothing stronger to check against — trust the liveness check alone
  const currentStartTime = readProcessStartTime(contents.pid);
  if (currentStartTime === undefined) return true; // /proc unavailable on this platform — cannot verify further
  return currentStartTime === contents.startTime;
}

export function readLivePid(pidFile: string): number | undefined {
  if (!fs.existsSync(pidFile)) return undefined;
  const contents = parsePidFileContents(fs.readFileSync(pidFile, "utf8"));
  if (!contents) {
    fs.rmSync(pidFile, { force: true });
    return undefined;
  }
  try {
    process.kill(contents.pid, 0);
  } catch {
    fs.rmSync(pidFile, { force: true });
    return undefined;
  }
  if (!isRecordedProcessStillTheSameOne(contents)) {
    fs.rmSync(pidFile, { force: true });
    return undefined;
  }
  return contents.pid;
}

export function writePid(pidFile: string, pid: number): void {
  const contents: PidFileContents = { pid, startTime: readProcessStartTime(pid) };
  fs.writeFileSync(pidFile, JSON.stringify(contents), { encoding: "utf8", flag: "wx" });
}
