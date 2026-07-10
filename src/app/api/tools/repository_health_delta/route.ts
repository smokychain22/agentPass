import { runPhase3ToolRoute } from "@/lib/a2mcp/phase3-route";
import { executeRepositoryHealthDelta } from "@/lib/a2mcp/phase3-engine";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return runPhase3ToolRoute("repository_health_delta", request, executeRepositoryHealthDelta);
}
