import { NextResponse } from "next/server";
import { submitA2ATask, formatA2ATaskResponse } from "@/lib/a2a/orchestrator";
import type { A2ATaskType } from "@/lib/a2a/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const VALID_TYPES: A2ATaskType[] = [
  "repository.analysis",
  "repository.safe_cleanup",
  "repository.verified_cleanup",
  "repository.cleanup_pr",
  "repository.guard_activation",
];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const type = body.type as A2ATaskType;
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ success: false, error: "Invalid task type." }, { status: 400 });
    }
    if (typeof body.repoUrl !== "string" || !body.repoUrl.trim()) {
      return NextResponse.json({ success: false, error: "repoUrl is required." }, { status: 400 });
    }

    const task = await submitA2ATask(type, {
      repoUrl: body.repoUrl.trim(),
      branch: typeof body.branch === "string" ? body.branch.trim() : undefined,
      scanId: typeof body.scanId === "string" ? body.scanId.trim() : undefined,
      commitSha: typeof body.commitSha === "string" ? body.commitSha.trim() : undefined,
      findingIds: Array.isArray(body.findingIds)
        ? body.findingIds.filter((id): id is string => typeof id === "string")
        : undefined,
      quoteId: typeof body.quoteId === "string" ? body.quoteId.trim() : undefined,
      paymentReference:
        typeof body.paymentReference === "string" ? body.paymentReference.trim() : undefined,
      payer: typeof body.payer === "string" ? body.payer.trim() : undefined,
      callbackUrl: typeof body.callbackUrl === "string" ? body.callbackUrl.trim() : undefined,
      githubToken: typeof body.githubToken === "string" ? body.githubToken.trim() : undefined,
      demo: body.demo === true,
      contractId: typeof body.contractId === "string" ? body.contractId.trim() : undefined,
      contractDigest:
        typeof body.contractDigest === "string" ? body.contractDigest.trim() : undefined,
    });

    return NextResponse.json({ success: task.status === "completed" || !task.error, ...formatA2ATaskResponse(task) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "A2A task submission failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
