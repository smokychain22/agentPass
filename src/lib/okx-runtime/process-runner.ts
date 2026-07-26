import { execFile, spawn, type ChildProcess } from "node:child_process";

const SECRET_PATTERNS = [
  /(?:authorization|payment-signature|x-payment)\s*[:=]\s*[^\s]+/gi,
  /(?:api[_-]?key|private[_-]?key|secret|passphrase|token)\s*[:=]\s*[^\s]+/gi,
  /\b(?:gho|github_pat|sk-proj)-[A-Za-z0-9_-]+\b/g,
];

export interface ProcessRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
}

export interface ProcessRunResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}

export function redactProcessOutput(value: string): string {
  return SECRET_PATTERNS.reduce(
    (output, pattern) => output.replace(pattern, (match) => `${match.split(/[:=]/, 1)[0]}=[redacted]`),
    value
  );
}

function appendBounded(current: string, chunk: Buffer | string, limit: number): string {
  const next = current + chunk.toString();
  if (Buffer.byteLength(next) <= limit) return next;
  return next.slice(-limit);
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.killed) return;

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      execFile(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true },
        () => resolve()
      );
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

export async function runProcess(
  executable: string,
  args: readonly string[],
  options: ProcessRunOptions = {}
): Promise<ProcessRunResult> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const maxOutputBytes = options.maxOutputBytes ?? 256_000;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk, maxOutputBytes);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk, maxOutputBytes);
    });

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        ok: exitCode === 0 && !timedOut && !cancelled,
        exitCode,
        signal,
        stdout: redactProcessOutput(stdout),
        stderr: redactProcessOutput(stderr),
        timedOut,
        cancelled,
      });
    };

    const stop = async (reason: "timeout" | "cancel") => {
      if (settled) return;
      timedOut = reason === "timeout";
      cancelled = reason === "cancel";
      await terminateProcessTree(child);
      finish(child.exitCode, child.signalCode);
    };

    const timer = setTimeout(() => void stop("timeout"), timeoutMs);
    const onAbort = () => void stop("cancel");
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) => {
      stderr = appendBounded(stderr, error.message, maxOutputBytes);
      finish(null, null);
    });
    child.on("close", finish);
  });
}
