import { runToolRoute } from "@/lib/a2mcp/responses";
import { executeFindDeadFiles } from "@/lib/a2mcp/tools/find-dead-files";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return runToolRoute("find_dead_files", request, executeFindDeadFiles);
}
