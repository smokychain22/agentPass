import { runPhase3ToolRoute } from "@/lib/a2mcp/phase3-route";
import { executeListFindings } from "@/lib/a2mcp/phase3-engine";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  return runPhase3ToolRoute("list_findings", request, executeListFindings, { paid: false });
}
