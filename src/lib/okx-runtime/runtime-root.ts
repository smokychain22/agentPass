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

export function resolveRuntimeRoot(): string {
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
