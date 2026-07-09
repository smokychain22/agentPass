import { runToolRoute } from "@/lib/a2mcp/responses";
import { executeDetectDuplicateCode } from "@/lib/a2mcp/tools/detect-duplicate-code";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return runToolRoute("detect_duplicate_code", request, executeDetectDuplicateCode);
}
