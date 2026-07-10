import { runPhase3ToolRoute } from "@/lib/a2mcp/phase3-route";
import { executeCreateCleanupPrPhase3 } from "@/lib/a2mcp/phase3-engine";
import { OPERATOR_TOOL_TIMEOUT_MS } from "@/lib/a2mcp/constants";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return runPhase3ToolRoute(
    "create_cleanup_pr",
    request,
    executeCreateCleanupPrPhase3,
    OPERATOR_TOOL_TIMEOUT_MS
  );
}
