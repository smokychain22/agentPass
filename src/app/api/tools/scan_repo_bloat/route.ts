import { runToolRoute } from "@/lib/a2mcp/responses";
import { executeScanRepoBloat } from "@/lib/a2mcp/tools/scan-repo-bloat";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return runToolRoute("scan_repo_bloat", request, executeScanRepoBloat);
}
