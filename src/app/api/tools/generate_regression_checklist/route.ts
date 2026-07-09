import { runToolRoute } from "@/lib/a2mcp/responses";
import { executeGenerateRegressionChecklist } from "@/lib/a2mcp/tools/generate-regression-checklist";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return runToolRoute("generate_regression_checklist", request, executeGenerateRegressionChecklist);
}
