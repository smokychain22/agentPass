import os from "node:os";
import path from "node:path";

/** True when the deployment root is read-only (Vercel Lambda, AWS Lambda). */
export function isServerlessRuntime(): boolean {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return true;
  }
  return process.cwd().startsWith("/var/task");
}

/** Writable ephemeral root for per-request workspaces (always under os.tmpdir() on serverless). */
export function ephemeralRuntimeRoot(): string {
  return path.join(os.tmpdir(), "repodiet");
}

/** Local-only durable file root; never used for runtime writes on serverless. */
export function localDurableRoot(): string {
  if (process.env.REPODIET_DATA_DIR) {
    return process.env.REPODIET_DATA_DIR;
  }
  if (isServerlessRuntime()) {
    return path.join(os.tmpdir(), "repodiet-data");
  }
  return path.join(process.cwd(), ".repodiet-runtime");
}

export function isRedisPersistenceEnabled(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  );
}
