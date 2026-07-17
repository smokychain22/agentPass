/**
 * Untrusted execution isolation for customer repositories.
 *
 * Secret filtering alone is NOT sandboxing.
 * Classification is COMPLETE only when commands run in a separate restricted container.
 */

import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import { buildUntrustedSandboxEnv, assertNoSecretsInSandboxEnv } from "./secret-firewall";
import { SANDBOX_LIMITS } from "./limits";

export type SandboxClassification = "COMPLETE" | "SANDBOX_INCOMPLETE";

export function classifyUntrustedSandbox(): SandboxClassification {
  if (process.env.REPODIET_UNTRUSTED_SANDBOX === "docker" && process.env.REPODIET_DOCKER_SANDBOX === "1") {
    return "COMPLETE";
  }
  return "SANDBOX_INCOMPLETE";
}

export function packageScriptsAllowed(): boolean {
  return classifyUntrustedSandbox() === "COMPLETE";
}

export class SandboxIncompleteError extends Error {
  code = "SANDBOX_INCOMPLETE" as const;
  constructor(message = "Untrusted package scripts require Docker isolation (SANDBOX INCOMPLETE).") {
    super(message);
  }
}

export async function assertDockerAvailable(): Promise<boolean> {
  try {
    const result = await execa("docker", ["version", "--format", "{{.Server.Version}}"], {
      reject: false,
      timeout: 5_000,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function refreshSandboxClassification(): Promise<SandboxClassification> {
  const dockerOk = await assertDockerAvailable();
  if (dockerOk && process.env.REPODIET_UNTRUSTED_SANDBOX !== "off") {
    process.env.REPODIET_DOCKER_SANDBOX = "1";
    process.env.REPODIET_UNTRUSTED_SANDBOX = "docker";
  }
  return classifyUntrustedSandbox();
}

export interface UntrustedCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  isolation: SandboxClassification;
}

/**
 * Run a command against a customer workspace inside a disposable Docker container.
 * Never mounts host secrets; never passes WORKER_/OKX_/GITHUB_APP_/signing env.
 */
export async function runUntrustedInDocker(input: {
  workspaceDir: string;
  command: string[];
  timeoutMs?: number;
  network?: "none" | "egress";
}): Promise<UntrustedCommandResult> {
  const started = Date.now();
  const classification = await refreshSandboxClassification();
  if (classification !== "COMPLETE") {
    throw new SandboxIncompleteError();
  }

  const env = buildUntrustedSandboxEnv(process.env);
  assertNoSecretsInSandboxEnv(env);

  const workAbs = path.resolve(input.workspaceDir);
  const timeoutMs = input.timeoutMs ?? SANDBOX_LIMITS.maxWallClockMs;
  const network = input.network === "egress" ? "bridge" : "none";

  const dockerArgs = [
    "run",
    "--rm",
    "--read-only",
    `--memory=${SANDBOX_LIMITS.maxMemoryMb}m`,
    `--cpus=${Math.max(0.5, SANDBOX_LIMITS.maxCpuSeconds / 600)}`,
    `--pids-limit=${SANDBOX_LIMITS.maxProcessCount}`,
    `--network=${network}`,
    "--tmpfs",
    "/tmp:rw,exec,size=512m",
    "-v",
    `${workAbs}:/workspace:rw`,
    "-w",
    "/workspace",
    // Explicitly do not mount docker.sock, host FS, or cloud metadata.
    "-e",
    "HOME=/tmp",
    "-e",
    "CI=true",
    "-e",
    "REPODIET_SANDBOX=untrusted",
    "node:20-bookworm",
    ...input.command,
  ];

  const result = await execa("docker", dockerArgs, {
    reject: false,
    timeout: timeoutMs,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    },
  });

  return {
    exitCode: result.exitCode,
    stdout: (result.stdout ?? "").slice(0, SANDBOX_LIMITS.maxOutputBytes),
    stderr: (result.stderr ?? "").slice(0, SANDBOX_LIMITS.maxOutputBytes),
    durationMs: Date.now() - started,
    isolation: "COMPLETE",
  };
}

/** Fail closed for npm/pnpm/yarn/bun package scripts until Docker isolation is active. */
export async function runCustomerPackageScript(input: {
  workspaceDir: string;
  command: string[];
  timeoutMs?: number;
}): Promise<UntrustedCommandResult> {
  if (!packageScriptsAllowed()) {
    throw new SandboxIncompleteError(
      "SANDBOX INCOMPLETE: customer package scripts cannot run inside the trusted worker process."
    );
  }
  return runUntrustedInDocker({
    ...input,
    network: "egress", // install may need registry; still no secrets, no docker.sock
  });
}

export async function destroyWorkspace(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}
