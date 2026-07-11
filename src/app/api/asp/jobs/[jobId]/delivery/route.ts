import { getAspJobDelivery } from "@/lib/asp/job-service";
import { aspError, aspJson, withAspOperatorAuth } from "@/lib/asp/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  return withAspOperatorAuth(request, async () => {
    const { jobId } = await context.params;
    const delivery = await getAspJobDelivery(jobId);
    if (!delivery) {
      return aspError("ASP job not found.", 404);
    }
    return aspJson({ ok: true, ...delivery });
  });
}
