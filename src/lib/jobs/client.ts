import type { RateLimitSnapshot } from "@/lib/security/rate-limit";

export type JobPollStatus = "queued" | "running" | "complete" | "failed";

export interface JobPollResponse<T> {
  success: boolean;
  jobId: string;
  status: JobPollStatus;
  stage: string;
  progress: null;
  isDemo?: boolean;
  result?: T;
  error?: string;
}

export class RateLimitHttpError extends Error {
  rateLimit: RateLimitSnapshot;

  constructor(message: string, rateLimit: RateLimitSnapshot) {
    super(message);
    this.name = "RateLimitHttpError";
    this.rateLimit = rateLimit;
  }
}

function parseRateLimitSnapshot(
  res: Response,
  json: { rateLimit?: RateLimitSnapshot }
): RateLimitSnapshot {
  if (json.rateLimit) return json.rateLimit;

  const retryHeader = Number(res.headers.get("Retry-After") ?? "60");
  const retryAfterSeconds = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : 60;

  return {
    code: "rate_limit_exceeded",
    retryAfterSeconds,
    limit: 0,
    remaining: 0,
    resetAt: new Date(Date.now() + retryAfterSeconds * 1000).toISOString(),
  };
}

function throwIfRateLimited(
  res: Response,
  json: { error?: string; rateLimit?: RateLimitSnapshot }
): void {
  if (res.status !== 429) return;
  throw new RateLimitHttpError(
    json.error ?? "Rate limit exceeded. Please wait before retrying.",
    parseRateLimitSnapshot(res, json)
  );
}

export async function pollJob<T>(
  endpoint: string,
  jobId: string,
  onStage: (stage: string) => void,
  options?: { intervalMs?: number; timeoutMs?: number }
): Promise<T> {
  const intervalMs = options?.intervalMs ?? 800;
  const timeoutMs = options?.timeoutMs ?? 300_000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${endpoint}/${jobId}`);
    const json = (await res.json()) as JobPollResponse<T>;

    if (!json.success) {
      throw new Error(json.error ?? "Job polling failed.");
    }

    onStage(json.stage);

    if (json.status === "complete" && json.result) {
      return json.result;
    }

    if (json.status === "failed") {
      throw new Error(json.error ?? "Job failed.");
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Job timed out.");
}

export async function startJob(
  endpoint: string,
  body: Record<string, unknown>
): Promise<string> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as {
    success: boolean;
    jobId?: string;
    status?: JobPollStatus;
    result?: unknown;
    error?: string;
    rateLimit?: RateLimitSnapshot;
  };

  throwIfRateLimited(res, json);

  if (!json.success && json.status !== "complete") {
    throw new Error(json.error ?? "Failed to start job.");
  }

  if (!json.jobId) {
    throw new Error(json.error ?? "Failed to start job.");
  }

  return json.jobId;
}

export async function startJobOrResult<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<{ jobId: string; result?: T; status?: JobPollStatus }> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as JobPollResponse<T> & {
    success: boolean;
    error?: string;
    x402Version?: number;
    rateLimit?: RateLimitSnapshot;
  };

  if (res.status === 402 || json.x402Version) {
    throw new Error(
      "Payment required for patch bundle generation. x402 settlement is not enabled on this deployment yet — contact support or retry after payment is configured."
    );
  }

  throwIfRateLimited(res, json);

  if (!res.ok && !json.jobId) {
    throw new Error(json.error ?? `Request failed (${res.status}).`);
  }

  if (!json.jobId) {
    throw new Error(json.error ?? "Failed to start job.");
  }

  if (json.status === "complete" && json.result) {
    return { jobId: json.jobId, result: json.result, status: "complete" };
  }

  if (json.status === "failed") {
    throw new Error(json.error ?? "Job failed.");
  }

  return { jobId: json.jobId, status: json.status };
}
