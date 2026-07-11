import { runToolRoute } from "@/lib/a2mcp/responses";
import { executeGenerateCleanupPatch } from "@/lib/a2mcp/tools/generate-cleanup-patch";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return runToolRoute("generate_cleanup_patch", request, executeGenerateCleanupPatch);
}
