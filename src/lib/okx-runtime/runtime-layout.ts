import fs from "node:fs";
import path from "node:path";

export type OkxRuntimeRole = "buyer" | "seller";

export interface OkxRuntimeIdentity {
  role: OkxRuntimeRole;
  agentId: "5295" | "5283";
  walletAddress: string;
}

export const OKX_RUNTIME_IDENTITIES: Record<OkxRuntimeRole, OkxRuntimeIdentity> = {
  buyer: {
    role: "buyer",
    agentId: "5295",
    walletAddress: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
  },
  seller: {
    role: "seller",
    agentId: "5283",
    walletAddress: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
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

export function readLivePid(pidFile: string): number | undefined {
  if (!fs.existsSync(pidFile)) return undefined;
  const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    fs.rmSync(pidFile, { force: true });
    return undefined;
  }
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    fs.rmSync(pidFile, { force: true });
    return undefined;
  }
}

export function writePid(pidFile: string, pid: number): void {
  fs.writeFileSync(pidFile, `${pid}\n`, { encoding: "utf8", flag: "wx" });
}
