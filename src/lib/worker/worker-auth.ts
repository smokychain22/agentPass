import { timingSafeEqual } from "node:crypto";

function readSecret(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function workerApiKeyConfigured(): boolean {
  return Boolean(readSecret("WORKER_API_KEY"));
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

export function validateWorkerCallbackSecret(header: string | null): boolean {
  const expected = readSecret("WORKER_CALLBACK_SECRET") ?? readSecret("WORKER_API_KEY");
  if (!expected || !header) return false;
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
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

export class WorkerAuthError extends Error {
  constructor(
    public readonly code: "WORKER_AUTH_MISSING" | "WORKER_AUTH_INVALID",
    message: string
  ) {
    super(message);
  }
}
