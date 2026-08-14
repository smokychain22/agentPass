/**
 * Where this Machine's durable runtime state lives, shared by every process
 * that needs to agree on a location without a network round-trip.
 *
 * Extracted from `scripts/repodiet-seller-runtime.ts` (which had a private,
 * near-identical copy) so it can also be used by `heavy-job-limiter.ts`'s
 * cross-process lock — see the Incident #29 note there for why a single
 * process's resolution of "where" was not enough on its own.
 */
import path from "node:path";
import os from "node:os";
import { ephemeralRuntimeRoot, isServerlessRuntime } from "@/lib/server/runtime-env";

export function resolveRuntimeRoot(): string {
  /**
   * `REPODIET_OKX_RUNTIME_ROOT` names a directory on the persistent Fly.io
   * Machine every long-lived process there shares (see the module docblock).
   * On Vercel there is no such Machine — each invocation is its own isolated,
   * ephemeral compute environment, so a path meant to be durable and shared
   * across Fly processes is neither reachable nor meaningful there. Using it
   * anyway crashed every `createCleanupPullRequest` call made directly on
   * Vercel (the operator UI's own delivery path) with
   * `ENOENT: no such file or directory, mkdir '/persistent/...'` — discovered
   * live 2026-08-14 verifying the GitHub Actions sandbox worker end to end.
   * Falls back to the same ephemeral, always-writable root `server/workspace.ts`
   * already uses for serverless scan workspaces.
   */
  if (isServerlessRuntime()) {
    return path.resolve(ephemeralRuntimeRoot());
  }
  const explicit = process.env.REPODIET_OKX_RUNTIME_ROOT?.trim();
  if (explicit) return path.resolve(explicit);
  const platformData =
    process.env.XDG_DATA_HOME?.trim() ||
    process.env.LOCALAPPDATA?.trim() ||
    (process.platform === "win32"
      ? path.join(os.homedir(), "AppData", "Local")
      : path.join(os.homedir(), ".local", "share"));
  return path.resolve(path.join(platformData, "RepoDiet", "okx-runtimes"));
}
