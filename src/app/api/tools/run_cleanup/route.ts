import { runPhase3ToolRoute } from "@/lib/a2mcp/phase3-route";
import { executeRunCleanup } from "@/lib/a2mcp/phase3-engine";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return runPhase3ToolRoute("run_cleanup", request, executeRunCleanup);
}
