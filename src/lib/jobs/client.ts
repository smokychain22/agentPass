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
  };

  if (!json.success && json.status !== "complete") {
    throw new Error(json.error ?? "Failed to start job.");
  }

  if (!json.jobId) {
    throw new Error(json.error ?? "Failed to start job.");
  }

  return json.jobId;
}

/** Start job; returns result immediately when POST runs synchronously (production). */
export async function startJobOrResult<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<{ jobId: string; result?: T; status?: JobPollStatus }> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as JobPollResponse<T> & { success: boolean };

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
