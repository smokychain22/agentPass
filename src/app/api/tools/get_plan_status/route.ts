import { runPhase3ToolRoute } from "@/lib/a2mcp/phase3-route";
import { executeGetPlanStatus } from "@/lib/a2mcp/phase3-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return runPhase3ToolRoute("get_plan_status", request, executeGetPlanStatus, { paid: false });
}
