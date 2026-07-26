import { NextResponse } from "next/server";
import { runPhase3ToolRoute } from "@/lib/a2mcp/phase3-route";
import { executeQuickTriage } from "@/lib/a2mcp/quick-triage-engine";
import { ToolExecutionError } from "@/lib/a2mcp/errors";
import { buildToolErrorResponse } from "@/lib/a2mcp/tool-contract";
import { createTaskId } from "@/lib/a2mcp/task-store";
import {
  executeGreenPrVerification,
  isGreenPrVerificationOperation,
} from "@/lib/a2mcp/green-pr-verification";
import { normalizeRepositoryTarget } from "@/lib/repository/repository-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 25;

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
  let rawBody: string;
  try {
    rawBody = await request.text();
    body = JSON.parse(rawBody) as Record<string, unknown>;
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
      body: rawBody,
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

  const forwardedRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: rawBody,
  });

  return runPhase3ToolRoute(
    "analyze_repository",
    forwardedRequest,
    async (paidBody, paidTaskId) => {
      const paidRecord = paidBody as Record<string, unknown>;
      let repositoryTarget: Awaited<ReturnType<typeof normalizeRepositoryTarget>>;
      try {
        repositoryTarget = await normalizeRepositoryTarget({
          repositoryUrl,
          branch,
          resolveRemote: true,
        });
      } catch {
        throw new ToolExecutionError(
          "REPO_NOT_FOUND",
          "The public GitHub repository or requested branch could not be resolved to a commit.",
          422
        );
      }

      return executeQuickTriage(
        {
          ...paidRecord,
          repoUrl: repositoryUrl,
          repositoryUrl,
          branch: repositoryTarget.branch,
          commitSha: repositoryTarget.sourceCommit,
          maximumFindings: Math.floor(maximumFindings),
          source: "quick_triage",
          operation: "analyze_repository",
        },
        paidTaskId
      );
    },
    {
      timeoutMs: undefined, // use QUICK_TRIAGE_TIMEOUT_MS via tool name
    }
  );
}

