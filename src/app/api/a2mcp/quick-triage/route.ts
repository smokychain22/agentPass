import { NextResponse } from "next/server";
import { runPhase3ToolRoute } from "@/lib/a2mcp/phase3-route";
import { executeQuickTriage } from "@/lib/a2mcp/quick-triage-engine";
import { buildToolErrorResponse } from "@/lib/a2mcp/tool-contract";
import { createTaskId } from "@/lib/a2mcp/task-store";
import {
  executeGreenPrVerification,
  isGreenPrVerificationOperation,
} from "@/lib/a2mcp/green-pr-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isValidPublicGitHubRepository(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname !== "github.com") return false;
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts.length >= 2;
  } catch {
    return false;
  }
}

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
      { status: 400 }
    );
  }

  const repositoryUrl =
    typeof body.repositoryUrl === "string" ? body.repositoryUrl.trim() : "";
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
  const branch = typeof body.branch === "string" ? body.branch.trim() : undefined;
  const maximumFindingsRaw = body.maximumFindings;
  const maximumFindings =
    maximumFindingsRaw === undefined ? 10 : Number(maximumFindingsRaw);

  if (!repositoryUrl) {
    return NextResponse.json(
      buildToolErrorResponse(
        "analyze_repository",
        taskId,
        "INVALID_INPUT",
        "repositoryUrl is required."
      ),
      { status: 400 }
    );
  }

  if (!isValidPublicGitHubRepository(repositoryUrl)) {
    return NextResponse.json(
      buildToolErrorResponse(
        "analyze_repository",
        taskId,
        "UNSUPPORTED_REPOSITORY",
        "Only public https://github.com/owner/repo repositories are supported."
      ),
      { status: 422 }
    );
  }

  if (!Number.isFinite(maximumFindings) || maximumFindings < 1 || maximumFindings > 10) {
    return NextResponse.json(
      buildToolErrorResponse(
        "analyze_repository",
        taskId,
        "INVALID_INPUT",
        "maximumFindings must be a number between 1 and 10."
      ),
      { status: 400 }
    );
  }

  const forwardedBody = {
    repoUrl: repositoryUrl,
    repositoryUrl,
    branch,
    maximumFindings: Math.floor(maximumFindings),
    source: "quick_triage",
    operation: "analyze_repository",
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

