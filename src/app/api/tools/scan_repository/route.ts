import { runPhase3ToolRoute } from "@/lib/a2mcp/phase3-route";
import { executeScanRepository } from "@/lib/a2mcp/phase3-engine";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return runPhase3ToolRoute("scan_repository", request, executeScanRepository);
}
