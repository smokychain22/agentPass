import { NextResponse } from "next/server";
import {
  submitA2ATask,
  formatA2ATaskResponse,
  formatAsyncA2ATaskAcknowledgement,
} from "@/lib/a2a/orchestrator";
import type { A2ATaskType } from "@/lib/a2a/types";
import {
  buildInformationalResponse,
  buildMarketplaceIntakeResponse,
  buildTaskStatusGuidanceResponse,
  extractTaskId,
  extractUserMessage,
  isInformationalQuery,
  isMarketplaceDiscoveryMessage,
  isTaskStatusQuery,
  resolveIntakeRepositoryUrl,
  inferCleanupTaskTypeFromText,
} from "@/lib/a2a/marketplace-intake";
import { nanoid } from "nanoid";
import {
  logMarketplaceTelemetry,
  touchMarketplaceHealth,
} from "@/lib/okx/marketplace-telemetry";
import {
  recordInboundTaskReceived,
  recordTaskAcknowledged,
} from "@/lib/a2a/agent-runtime-health";

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
    const repoUrl = resolveIntakeRepositoryUrl(body);
    await recordInboundTaskReceived();

    // Discovery-only when the reviewer asks for the agent but has not supplied a repository yet.
    // If repoUrl (or a GitHub URL inside the message) is present, continue into durable task intake.
    if (message && isMarketplaceDiscoveryMessage(message) && !repoUrl) {
      logMarketplaceTelemetry("a2a_message_received", { requestId, channel: "a2a_tasks" });
      const intake = buildMarketplaceIntakeResponse(requestId);
      await recordTaskAcknowledged({ queueDepth: 0, responseLatencyMs: Date.now() - started });
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

    // Conversational status/capability question ("is it online", "what does X do") —
    // answer informatively instead of rejecting as an unmapped task type.
    if (message && isInformationalQuery(message) && !repoUrl) {
      logMarketplaceTelemetry("a2a_message_received", { requestId, channel: "a2a_tasks" });
      const info = buildInformationalResponse(requestId);
      await recordTaskAcknowledged({ queueDepth: 0, responseLatencyMs: Date.now() - started });
      logMarketplaceTelemetry("a2a_acknowledgement_sent", {
        requestId,
        durationMs: Date.now() - started,
      });
      await touchMarketplaceHealth({ a2aInitialResponseReady: true });
      return NextResponse.json({
        success: true,
        ...info,
        responseTimeMs: Date.now() - started,
      });
    }

    // A caller asking about THEIR task's status ("what is the current status
    // of my task?") — answered directly (real per-task URL, or a real lookup
    // pointer) rather than rejected as an unmapped task type. Guarded on
    // !repoUrl for the same reason as the branches above: a message that also
    // carries a repository must still continue into real task intake.
    if (message && isTaskStatusQuery(message) && !repoUrl) {
      logMarketplaceTelemetry("a2a_message_received", { requestId, channel: "a2a_tasks" });
      const guidance = buildTaskStatusGuidanceResponse(requestId, extractTaskId(body));
      await recordTaskAcknowledged({ queueDepth: 0, responseLatencyMs: Date.now() - started });
      logMarketplaceTelemetry("a2a_acknowledgement_sent", {
        requestId,
        durationMs: Date.now() - started,
      });
      await touchMarketplaceHealth({ a2aInitialResponseReady: true });
      return NextResponse.json({
        success: true,
        ...guidance,
        responseTimeMs: Date.now() - started,
      });
    }

    // A counterparty states intent in prose, not as a `type` field. Without
    // the last fallback, "The task is: type=create_cleanup_pr" answered
    // INVALID_TASK_TYPE — OKX rejection class #6, reproduced live on
    // 2026-08-02. Inferring only a stated cleanup intent (never a discovery
    // question) yields the accurate SCOPE_REQUIRED answer instead.
    const type =
      typeof body.type === "string" && VALID_TYPES.includes(body.type as A2ATaskType)
        ? (body.type as A2ATaskType)
        : repoUrl
          ? ("repository.safe_cleanup" as A2ATaskType)
          : ((inferCleanupTaskTypeFromText(message) as A2ATaskType | undefined) ??
            (body.type as A2ATaskType));
    if (!VALID_TYPES.includes(type)) {
      /**
       * A free-form message that matched none of the classifiers above is
       * answered informatively rather than rejected.
       *
       * === Why this replaces "add one more regex" ===
       *
       * Every INVALID_TASK_TYPE rejection OKX has raised was fixed by appending
       * another pattern to marketplace-intake.ts — see its own comments for
       * three separate rounds (#141, #143, and live reproductions on 2026-08-02
       * and 2026-08-03). That approach can only ever catch phrasings someone
       * already thought of, and the next unanticipated one is another rejected
       * review.
       *
       * Reproduced live against production on 2026-08-07, a plain capability
       * question — "I have a GitHub repository with dead code. Can RepoDiet
       * help?" — still returned HTTP 400 "could not map it to a cleanup task
       * type". Telling a prospective customer we cannot understand them is
       * never the better answer to an ordinary sentence, and it is precisely
       * the "Agent did not respond" class OKX rejected this listing for.
       *
       * So the default for a HUMAN MESSAGE inverts: describe the two services
       * and say what is needed to start. That is always a truthful, useful
       * reply, and it demands nothing the caller has not already offered.
       *
       * A caller who explicitly supplied a `type` field still gets the hard
       * error below: that is a structured API contract violation, where naming
       * an unsupported type is a real mistake worth reporting precisely rather
       * than papering over with prose.
       */
      const declaredType = typeof body.type === "string" ? body.type.trim() : "";
      if (message && !declaredType) {
        logMarketplaceTelemetry("a2a_message_received", { requestId, channel: "a2a_tasks" });
        const info = buildInformationalResponse(requestId);
        await recordTaskAcknowledged({ queueDepth: 0, responseLatencyMs: Date.now() - started });
        logMarketplaceTelemetry("a2a_acknowledgement_sent", {
          requestId,
          durationMs: Date.now() - started,
        });
        await touchMarketplaceHealth({ a2aInitialResponseReady: true });
        return NextResponse.json({
          success: true,
          ...info,
          // Named so this is auditable as the fallback rather than looking like
          // a pattern match, and so the next unanticipated phrasing is visible
          // in telemetry instead of silently absorbed.
          classification: "unclassified_conversational_message",
          responseTimeMs: Date.now() - started,
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: "Invalid task type.",
          acknowledged: true,
          message: declaredType
            ? `RepoDiet does not support task type "${declaredType}". Supported types: ${VALID_TYPES.join(", ")}. Provide one of those with a repoUrl, or send a plain message describing what you need.`
            : "RepoDiet received your request but it carried no message and no repository. Provide type + repoUrl, or send a message describing what you need.",
          code: "INVALID_TASK_TYPE",
          supportedTypes: VALID_TYPES,
          retryable: true,
          requestId,
        },
        { status: 400 }
      );
    }
    if (!repoUrl) {
      await recordTaskAcknowledged({ queueDepth: 0 });
      return NextResponse.json(
        {
          success: false,
          error: "repoUrl is required for task execution. For marketplace discovery, send message/prompt.",
          code: "SCOPE_REQUIRED",
          acknowledged: true,
          immediateAcknowledgement: true,
          marketplaceLifecycle: "WAITING_FOR_REPOSITORY",
          message:
            "RepoDiet received your repository-cleanup task. Provide the repository URL or connect the RepoDiet GitHub App.",
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
        repoUrl,
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
      await recordTaskAcknowledged({ queueDepth: 1 });
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

    await recordTaskAcknowledged({ queueDepth: 0 });
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
        acknowledged: true,
        message: `RepoDiet received your request but could not complete intake: ${message}`,
        retryable: true,
        paymentRequired: false,
        paymentAlreadySettled: false,
        requestId,
      },
      { status: 422 }
    );
  }
}
