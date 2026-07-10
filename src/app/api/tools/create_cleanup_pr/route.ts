import { OPERATOR_TOOL_TIMEOUT_MS } from "@/lib/a2mcp/constants";
import { runToolRoute } from "@/lib/a2mcp/responses";
import { executeCreateCleanupPr } from "@/lib/a2mcp/tools/create-cleanup-pr";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return runToolRoute(
    "create_cleanup_pr",
    request,
    executeCreateCleanupPr,
    OPERATOR_TOOL_TIMEOUT_MS
  );
}
