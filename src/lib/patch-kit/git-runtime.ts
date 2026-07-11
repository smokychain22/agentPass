import { execa } from "execa";

let cachedGitAvailable: boolean | null = null;
let cachedGitVersion: string | null = null;

/** Detect whether the git CLI is available (cached per process). */
export async function isGitCliAvailable(): Promise<boolean> {
  if (cachedGitAvailable !== null) return cachedGitAvailable;
  try {
    const result = await execa("git", ["--version"], { reject: false, timeout: 5_000 });
    cachedGitAvailable = result.exitCode === 0;
    cachedGitVersion = (result.stdout || result.stderr || "").trim() || null;
  } catch {
    cachedGitAvailable = false;
    cachedGitVersion = null;
  }
  return cachedGitAvailable;
}

export function getGitVersion(): string | null {
  return cachedGitVersion;
}

export async function ensureGitRepoInitialized(rootDir: string): Promise<boolean> {
  const init = await execa("git", ["init"], { cwd: rootDir, reject: false, timeout: 30_000 });
  if (init.exitCode !== 0) return false;
  const add = await execa("git", ["add", "-A"], { cwd: rootDir, reject: false, timeout: 60_000 });
  if (add.exitCode !== 0) return false;
  const commit = await execa(
    "git",
    [
      "-c",
      "user.email=repodiet@local",
      "-c",
      "user.name=RepoDiet",
      "commit",
      "-m",
      "repodiet-baseline",
      "--allow-empty",
    ],
    { cwd: rootDir, reject: false, timeout: 30_000 }
  );
  if (commit.exitCode !== 0) return false;
  const head = await execa("git", ["rev-parse", "HEAD"], { cwd: rootDir, reject: false });
  return head.exitCode === 0 && Boolean(head.stdout?.trim());
}
