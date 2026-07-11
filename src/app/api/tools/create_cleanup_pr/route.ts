import { NextResponse } from "next/server";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { runPhase3ToolRoute } from "@/lib/a2mcp/phase3-route";
import { executeCreateCleanupPrPhase3 } from "@/lib/a2mcp/phase3-engine";
import { OPERATOR_TOOL_TIMEOUT_MS } from "@/lib/a2mcp/constants";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const sessionKey = await buildSessionKey(request);
  return runPhase3ToolRoute(
    "create_cleanup_pr",
    request,
    (body, taskId) =>
      executeCreateCleanupPrPhase3(
        { ...(body as Record<string, unknown>), sessionKey },
        taskId
      ),
    { timeoutMs: OPERATOR_TOOL_TIMEOUT_MS }
  );
}
