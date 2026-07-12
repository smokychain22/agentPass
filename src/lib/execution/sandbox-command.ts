import type { Sandbox } from "@vercel/sandbox";
import type { CommandFinished } from "@vercel/sandbox";

const SECRET_PATTERNS = [
  /ghs_[A-Za-z0-9_]+/g,
  /ghp_[A-Za-z0-9_]+/g,
  /github_pat_[A-Za-z0-9_]+/g,
  /x-access-token:[^@\s]+/g,
];

export function redactSecrets(text: string, extraSecrets: string[] = []): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  for (const secret of extraSecrets) {
    if (!secret) continue;
    out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

export interface SandboxCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function runSandboxCommand(
  sandbox: Sandbox,
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    secrets?: string[];
    timeoutMs?: number;
  }
): Promise<SandboxCommandResult> {
  const started = Date.now();
  const result: CommandFinished = await sandbox.runCommand({
    cmd: command,
    args,
    cwd: options?.cwd,
    env: options?.env,
    timeoutMs: options?.timeoutMs,
  });

  const stdout = redactSecrets((await result.stdout()) ?? "", options?.secrets);
  const stderr = redactSecrets((await result.stderr()) ?? "", options?.secrets);

  return {
    exitCode: result.exitCode ?? 1,
    stdout,
    stderr,
    durationMs: Date.now() - started,
  };
}

export async function runSandboxShell(
  sandbox: Sandbox,
  script: string,
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    secrets?: string[];
    timeoutMs?: number;
  }
): Promise<SandboxCommandResult> {
  return runSandboxCommand(sandbox, "bash", ["-lc", script], options);
}
