import { runPhase3ToolRoute } from "@/lib/a2mcp/phase3-route";
import { executeRunQuickCleanup } from "@/lib/a2mcp/phase3-engine";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return runPhase3ToolRoute("run_quick_cleanup", request, executeRunQuickCleanup);
}
