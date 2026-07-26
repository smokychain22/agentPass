#!/usr/bin/env tsx
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildIsolatedRuntimeEnv,
  ensureRuntimeLayout,
  getRuntimePaths,
  OKX_RUNTIME_IDENTITIES,
  readLivePid,
  type OkxRuntimeRole,
  writePid,
} from "../src/lib/okx-runtime/runtime-layout";

const baseDirectory = path.resolve(
  process.env.REPODIET_OKX_RUNTIME_ROOT || ".repodiet-okx-runtimes"
);

function commandFor(role: OkxRuntimeRole): string[] {
  const variable = role === "buyer" ? "REPODIET_OKX_BUYER_COMMAND" : "REPODIET_OKX_SELLER_COMMAND";
  const raw = process.env[variable];
  if (!raw) throw new Error(`${variable}_required_as_json_argument_array`);
  const parsed = JSON.parse(raw) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((part) => typeof part !== "string" || !part)
  ) {
    throw new Error(`${variable}_must_be_json_argument_array`);
  }
  return parsed;
}

function start(role: OkxRuntimeRole): number {
  const paths = getRuntimePaths(baseDirectory, role);
  ensureRuntimeLayout(paths);
  const existing = readLivePid(paths.pidFile);
  if (existing) return existing;

  const command = commandFor(role);
  const logPath = path.join(paths.logs, "runtime.log");
  const log = fs.openSync(logPath, "a");
  const child = spawn(command[0], command.slice(1), {
    cwd: paths.root,
    env: buildIsolatedRuntimeEnv(process.env, paths, OKX_RUNTIME_IDENTITIES[role]),
    shell: false,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", log, log],
  });
  if (!child.pid) throw new Error(`${role}_runtime_failed_to_start`);
  writePid(paths.pidFile, child.pid);
  child.unref();
  return child.pid;
}

async function stop(role: OkxRuntimeRole): Promise<void> {
  const paths = getRuntimePaths(baseDirectory, role);
  const pid = readLivePid(paths.pidFile);
  if (!pid) return;

  if (process.platform === "win32") {
    await new Promise<void>((resolve, reject) => {
      execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, (error) => {
        if (error && readLivePid(paths.pidFile)) reject(error);
        else resolve();
      });
    });
  } else {
    process.kill(-pid, "SIGTERM");
  }
  fs.rmSync(paths.pidFile, { force: true });
}

function status(role: OkxRuntimeRole): void {
  const paths = getRuntimePaths(baseDirectory, role);
  console.log(
    JSON.stringify({
      role,
      agentId: OKX_RUNTIME_IDENTITIES[role].agentId,
      walletAddress: OKX_RUNTIME_IDENTITIES[role].walletAddress,
      pid: readLivePid(paths.pidFile) ?? null,
      home: paths.home,
      eventStore: paths.eventStore,
    })
  );
}

async function main() {
  const action = process.argv[2];
  const role = process.argv[3] as OkxRuntimeRole | "both" | undefined;
  if (!["start", "stop", "status"].includes(action) || !["buyer", "seller", "both"].includes(role ?? "")) {
    throw new Error("usage: tsx scripts/okx-runtime-manager.ts <start|stop|status> <buyer|seller|both>");
  }
  const roles: OkxRuntimeRole[] = role === "both" ? ["seller", "buyer"] : [role as OkxRuntimeRole];
  for (const current of roles) {
    if (action === "start") console.log(`${current}:${start(current)}`);
    if (action === "stop") await stop(current);
    if (action === "status") status(current);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
