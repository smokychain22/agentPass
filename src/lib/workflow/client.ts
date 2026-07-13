import type { RepositoryConnectionStatus } from "./github-repository-status";
import type { EligibilityPreflightResult } from "./eligibility-preflight";

export interface WorkflowQuote {
  quoteId: string;
  amountMicro: string;
  priceLabel: string;
  currency: string;
  network: string;
  recipient: string;
  expiresAt?: string;
  payer?: string;
  paymentReference?: string;
  operation: string;
  repository: string;
  commitSha: string;
  findingIds: string[];
  settlementMode?: "trusted_test" | "test_hmac" | "live_x402";
}

export interface WorkflowA2ATask {
  taskId: string;
  type: string;
  status: string;
  repository: {
    owner: string;
    name: string;
    branch: string;
    commitSha?: string;
  };
  transitions: Array<{ status: string; at: string; detail?: string }>;
  pullRequest?: { url?: string; branch?: string; number?: number; title?: string };
  receipt?: Record<string, unknown>;
  verification?: { status?: string };
  error?: string;
  limitations?: string[];
  approval?: {
    summary?: string;
    changes?: Array<{ path: string; action: string; summary?: string }>;
  };
}

export async function fetchRepositoryStatus(input: {
  repository: string;
  branch?: string;
  commitSha?: string;
}): Promise<RepositoryConnectionStatus> {
  const params = new URLSearchParams({ repository: input.repository });
  if (input.branch) params.set("branch", input.branch);
  if (input.commitSha) params.set("commitSha", input.commitSha);
  const res = await fetch(`/api/github/repository-status?${params}`);
  const data = (await res.json()) as RepositoryConnectionStatus & { ok: boolean; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? "Failed to load GitHub status.");
  }
  return data;
}

export async function runEligibilityPreflightApi(input: {
  scanId: string;
  repoUrl?: string;
  branch?: string;
  findingIds?: string[];
}): Promise<{ results: EligibilityPreflightResult[]; summary: { ready: number; reviewFirst: number; protected: number } }> {
  const res = await fetch("/api/workflow/eligibility", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as {
    ok: boolean;
    results?: EligibilityPreflightResult[];
    summary?: { ready: number; reviewFirst: number; protected: number };
    error?: string;
  };
  if (!res.ok || !data.ok || !data.results) {
    throw new Error(data.error ?? "Eligibility preflight failed.");
  }
  return { results: data.results, summary: data.summary ?? { ready: 0, reviewFirst: 0, protected: 0 } };
}

export async function createWorkflowA2ATask(input: {
  repoUrl: string;
  branch?: string;
  scanId: string;
  commitSha: string;
  findingIds: string[];
}): Promise<{ task: WorkflowA2ATask; quote: WorkflowQuote | null; github: RepositoryConnectionStatus }> {
  const res = await fetch("/api/workflow/a2a", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as {
    ok: boolean;
    task?: WorkflowA2ATask;
    quote?: WorkflowQuote | null;
    github?: RepositoryConnectionStatus;
    error?: string;
    message?: string;
  };
  if (!res.ok || !data.ok || !data.task) {
    throw new Error(data.message ?? data.error ?? "Failed to create cleanup task.");
  }
  return {
    task: data.task,
    quote: data.quote ?? null,
    github: data.github!,
  };
}

export async function fetchWorkflowA2ATask(taskId: string): Promise<{
  task: WorkflowA2ATask;
  quote: WorkflowQuote | null;
}> {
  const res = await fetch(`/api/workflow/a2a?taskId=${encodeURIComponent(taskId)}`);
  const data = (await res.json()) as {
    ok: boolean;
    task?: WorkflowA2ATask;
    quote?: WorkflowQuote | null;
    error?: string;
  };
  if (!res.ok || !data.ok || !data.task) {
    throw new Error(data.error ?? "Task not found.");
  }
  return { task: data.task, quote: data.quote ?? null };
}

export async function payWorkflowQuote(input: {
  quoteId: string;
  paymentReference: string;
  payer: string;
  paymentSignature?: string;
}): Promise<{ success: boolean; existingTaskId?: string }> {
  const res = await fetch("/api/tasks/pay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as {
    success: boolean;
    existingTaskId?: string;
    error?: string;
  };
  if (!res.ok || !data.success) {
    throw new Error(data.error ?? "Payment verification failed.");
  }
  return data;
}

export async function fundWorkflowTask(input: {
  taskId: string;
  quoteId: string;
  paymentReference: string;
  payer: string;
  paymentSignature?: string;
}): Promise<WorkflowA2ATask> {
  const res = await fetch(`/api/a2a/tasks/${encodeURIComponent(input.taskId)}/fund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteId: input.quoteId,
      paymentReference: input.paymentReference,
      payer: input.payer,
      paymentSignature: input.paymentSignature,
    }),
  });
  const data = (await res.json()) as {
    success?: boolean;
    taskId?: string;
    status?: string;
    error?: string;
    alreadyProcessed?: boolean;
  };
  if (!res.ok) {
    throw new Error(data.error ?? "Funding failed.");
  }
  const polled = await fetchWorkflowA2ATask(input.taskId);
  return polled.task;
}

export async function approveWorkflowDelivery(taskId: string): Promise<WorkflowA2ATask> {
  const res = await fetch("/api/workflow/a2a", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, action: "approve" }),
  });
  const data = (await res.json()) as { ok: boolean; task?: WorkflowA2ATask; error?: string };
  if (!res.ok || !data.ok || !data.task) {
    throw new Error(data.error ?? "PR approval failed.");
  }
  return data.task;
}
