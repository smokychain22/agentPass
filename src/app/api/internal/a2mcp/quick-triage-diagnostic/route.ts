import { NextResponse } from "next/server";
import { runPhase3ToolRoute } from "@/lib/a2mcp/phase3-route";
import { executeQuickTriage } from "@/lib/a2mcp/quick-triage-engine";
import { buildToolErrorResponse } from "@/lib/a2mcp/tool-contract";
import { createTaskId } from "@/lib/a2mcp/task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Non-billable diagnostic path for Quick Triage.
 * Never creates/funds quotes and never moves balances.
 *
 * Enabled when:
 * - REPODIET_ALLOW_INTERNAL_DIAGNOSTIC=1, or
 * - NODE_ENV !== "production"
 *
 * Optional shared secret header: x-repodiet-diagnostic-secret
 */
function diagnosticAllowed(request: Request): boolean {
  const allowFlag = process.env.REPODIET_ALLOW_INTERNAL_DIAGNOSTIC === "1";
  const nonProd = process.env.NODE_ENV !== "production";
  if (!allowFlag && !nonProd) return false;

  const required = process.env.REPODIET_INTERNAL_DIAGNOSTIC_SECRET?.trim();
  if (!required) return allowFlag || nonProd;
  return request.headers.get("x-repodiet-diagnostic-secret") === required;
}

export async function POST(request: Request) {
  const taskId = createTaskId();
  if (!diagnosticAllowed(request)) {
    return NextResponse.json(
      buildToolErrorResponse(
        "analyze_repository",
        taskId,
        "INVALID_INPUT",
        "Internal Quick Triage diagnostic is disabled."
      ),
      { status: 403 }
    );
  }

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
    (typeof body.repositoryUrl === "string" && body.repositoryUrl.trim()) ||
    (typeof body.repoUrl === "string" && body.repoUrl.trim()) ||
    "";
  const branch = typeof body.branch === "string" ? body.branch.trim() : "main";
  const maximumFindingsRaw = body.maximumFindings ?? body.maxFindings;
  const maximumFindings =
    maximumFindingsRaw === undefined ? 5 : Number(maximumFindingsRaw);

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

  const forwardedBody = {
    repoUrl: repositoryUrl,
    repositoryUrl,
    branch,
    maximumFindings: Number.isFinite(maximumFindings)
      ? Math.max(1, Math.min(10, Math.floor(maximumFindings)))
      : 5,
    source: "quick_triage_diagnostic",
    operation: "analyze_repository",
    diagnostic: true,
  };

  const forwardedRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(forwardedBody),
  });

  // paid:false — exact execution path without quote creation or settlement.
  return runPhase3ToolRoute("analyze_repository", forwardedRequest, executeQuickTriage, {
    paid: false,
  });
}
