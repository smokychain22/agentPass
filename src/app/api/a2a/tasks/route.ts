import { NextResponse } from "next/server";
import {
  submitA2ATask,
  formatA2ATaskResponse,
  formatAsyncA2ATaskAcknowledgement,
} from "@/lib/a2a/orchestrator";
import type { A2ATaskType } from "@/lib/a2a/types";
import {
  buildMarketplaceIntakeResponse,
  extractUserMessage,
  isMarketplaceDiscoveryMessage,
} from "@/lib/a2a/marketplace-intake";
import { nanoid } from "nanoid";
import {
  logMarketplaceTelemetry,
  touchMarketplaceHealth,
} from "@/lib/okx/marketplace-telemetry";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_TYPES: A2ATaskType[] = [
  "repository.analysis",
  "repository.safe_cleanup",
  "repository.verified_cleanup",
  "repository.cleanup_pr",
  "repository.guard_activation",
];

export async function POST(request: Request) {
  const requestId = `req_${nanoid(12)}`;
  const started = Date.now();

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const message = extractUserMessage(body);

    if (message && isMarketplaceDiscoveryMessage(message)) {
      logMarketplaceTelemetry("a2a_message_received", { requestId, channel: "a2a_tasks" });
      const intake = buildMarketplaceIntakeResponse(requestId);
      logMarketplaceTelemetry("a2a_acknowledgement_sent", {
        requestId,
        durationMs: Date.now() - started,
      });
      await touchMarketplaceHealth({ a2aInitialResponseReady: true });
      return NextResponse.json({
        success: true,
        ...intake,
        responseTimeMs: Date.now() - started,
      });
    }

    const type = body.type as A2ATaskType;
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ success: false, error: "Invalid task type." }, { status: 400 });
    }
    if (typeof body.repoUrl !== "string" || !body.repoUrl.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: "repoUrl is required for task execution. For marketplace discovery, send message/prompt.",
          code: "SCOPE_REQUIRED",
          retryable: true,
          paymentRequired: false,
          paymentAlreadySettled: false,
          requestId,
        },
        { status: 400 }
      );
    }

    const asyncDelivery = body.asyncDelivery !== false;
    const task = await submitA2ATask(
      type,
      {
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
        purchaseChannel: "okx_marketplace",
      },
      { asyncDelivery }
    );

    if (asyncDelivery && (task.status === "queued" || task.status === "submitted")) {
      const ack = formatAsyncA2ATaskAcknowledgement(task);
      logMarketplaceTelemetry("a2a_acknowledgement_sent", {
        requestId,
        taskId: task.id,
        durationMs: Date.now() - started,
      });
      return NextResponse.json({
        success: true,
        ...ack,
        task: formatA2ATaskResponse(task),
        responseTimeMs: Date.now() - started,
      });
    }

    return NextResponse.json({
      success: task.status === "completed" || !task.error,
      ...formatA2ATaskResponse(task),
      responseTimeMs: Date.now() - started,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "A2A task submission failed.";
    return NextResponse.json(
      {
        success: false,
        error: message,
        code: "TASK_SUBMISSION_FAILED",
        retryable: true,
        paymentRequired: false,
        paymentAlreadySettled: false,
        requestId,
      },
      { status: 422 }
    );
  }
}
