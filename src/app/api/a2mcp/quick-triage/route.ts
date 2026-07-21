import { NextResponse } from "next/server";
import { runPhase3ToolRoute } from "@/lib/a2mcp/phase3-route";
import { executeQuickTriage } from "@/lib/a2mcp/quick-triage-engine";
import { buildToolErrorResponse } from "@/lib/a2mcp/tool-contract";
import { createTaskId } from "@/lib/a2mcp/task-store";
import { preflightA2mcpQuickTriage } from "@/lib/a2mcp/a2mcp-preflight";
import {
  executeGreenPrVerification,
  isGreenPrVerificationOperation,
} from "@/lib/a2mcp/green-pr-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 25;

export async function POST(request: Request) {
  const taskId = createTaskId();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      buildToolErrorResponse(
        "analyze_repository",
        taskId,
        "INVALID_INPUT",
        "Request body must be valid JSON."
      ),
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const requestedOperation = body.operation;

  if (isGreenPrVerificationOperation(requestedOperation)) {
    const forwardedRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(body),
    });
    // Preserve the existing paid A2MCP listing/service and its 0.03 USDT rail.
    return runPhase3ToolRoute(
      "analyze_repository",
      forwardedRequest,
      executeGreenPrVerification
    );
  }

  // Bound preflight BEFORE any 402 — reject impossible requests without payment.
  const preflight = await preflightA2mcpQuickTriage({
    operation: requestedOperation ?? "analyze_repository",
    repositoryUrl: body.repositoryUrl,
    branch: body.branch,
    maximumFindings: body.maximumFindings === undefined ? 3 : body.maximumFindings,
  });

  if (!preflight.ok) {
    return NextResponse.json(
      buildToolErrorResponse(
        "analyze_repository",
        taskId,
        preflight.code,
        preflight.message
      ),
      { status: preflight.status, headers: { "Cache-Control": "no-store" } }
    );
  }

  const forwardedBody = {
    repoUrl: preflight.repositoryUrl,
    repositoryUrl: preflight.repositoryUrl,
    branch: preflight.branch,
    commitSha: preflight.commitSha ?? undefined,
    maximumFindings: preflight.maximumFindings,
    source: "quick_triage",
    operation: "analyze_repository",
    normalizedRepository: preflight.normalizedRepository,
    requestIdentityHash: preflight.requestIdentityHash,
    quoteId: typeof body.quoteId === "string" ? body.quoteId : undefined,
    paymentReference:
      typeof body.paymentReference === "string" ? body.paymentReference : undefined,
    payer: typeof body.payer === "string" ? body.payer : undefined,
    idempotencyKey:
      typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
  };

  const forwardedRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(forwardedBody),
  });

  return runPhase3ToolRoute("analyze_repository", forwardedRequest, executeQuickTriage, {
    timeoutMs: undefined, // use QUICK_TRIAGE_TIMEOUT_MS via tool name
  });
}

