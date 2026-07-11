import { runAspJobById } from "@/lib/asp/job-service";
import { aspError, aspJson, withAspOperatorAuth } from "@/lib/asp/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  return withAspOperatorAuth(request, async () => {
    const { jobId } = await context.params;
    const status = await runAspJobById(jobId);
    if (!status) {
      return aspError("ASP job not found.", 404);
    }
    return aspJson({ ok: true, ...status });
  });
}
