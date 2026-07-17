import { timingSafeEqual } from "node:crypto";

function readSecret(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function workerApiKeyConfigured(): boolean {
  return Boolean(readSecret("WORKER_API_KEY"));
}

export function workerCallbackSecretConfigured(): boolean {
  return Boolean(readSecret("WORKER_CALLBACK_SECRET"));
}

export function validateWorkerApiKey(header: string | null): boolean {
  const expected = readSecret("WORKER_API_KEY");
  if (!expected || !header) return false;
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Validate the dedicated callback secret.
 * Does NOT fall back to WORKER_API_KEY — Actions complete/incident must use the callback secret.
 */
export function validateWorkerCallbackSecret(header: string | null): boolean {
  const expected = readSecret("WORKER_CALLBACK_SECRET");
  if (!expected || !header) return false;
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** Legacy fallback used by older always-on worker paths. */
export function validateWorkerCallbackSecretOrApiKey(header: string | null): boolean {
  if (validateWorkerCallbackSecret(header)) return true;
  return validateWorkerApiKey(header);
}

export function assertWorkerAuthorized(request: Request): void {
  const auth = request.headers.get("authorization");
  if (!auth) {
    throw new WorkerAuthError("WORKER_AUTH_MISSING", "Missing Authorization header.");
  }
  if (!validateWorkerApiKey(auth)) {
    throw new WorkerAuthError("WORKER_AUTH_INVALID", "Invalid worker API key.");
  }
}

/**
 * Trusted Actions complete/incident auth: require callback secret header.
 */
export function assertWorkerCallbackAuthorized(request: Request): void {
  const callback =
    request.headers.get("x-worker-callback-secret") ||
    request.headers.get("x-repodiet-callback-secret");
  if (!callback) {
    throw new WorkerAuthError("WORKER_AUTH_MISSING", "Missing x-worker-callback-secret header.");
  }
  if (!validateWorkerCallbackSecret(callback)) {
    throw new WorkerAuthError("WORKER_AUTH_INVALID", "Invalid worker callback secret.");
  }
}

export class WorkerAuthError extends Error {
  constructor(
    public readonly code: "WORKER_AUTH_MISSING" | "WORKER_AUTH_INVALID",
    message: string
  ) {
    super(message);
  }
}
