import { runPhase3ToolRoute } from "@/lib/a2mcp/phase3-route";
import { executeGetDeliveryStatus } from "@/lib/a2mcp/phase3-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return runPhase3ToolRoute("get_delivery_status", request, executeGetDeliveryStatus, {
    paid: false,
  });
}
