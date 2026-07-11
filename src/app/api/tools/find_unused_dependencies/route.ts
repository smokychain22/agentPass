import { runToolRoute } from "@/lib/a2mcp/responses";
import { executeFindUnusedDependencies } from "@/lib/a2mcp/tools/find-unused-dependencies";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return runToolRoute("find_unused_dependencies", request, executeFindUnusedDependencies);
}
