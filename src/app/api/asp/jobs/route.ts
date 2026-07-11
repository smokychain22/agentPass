import { createAspJob } from "@/lib/asp/job-service";
import { aspError, aspJson, withAspOperatorAuth } from "@/lib/asp/route-helpers";
import type { CreateAspJobInput } from "@/lib/asp/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return withAspOperatorAuth(request, async () => {
    try {
      const body = (await request.json()) as CreateAspJobInput;
      const result = await createAspJob(body);
      return aspJson({ ok: true, ...result }, result.status === "failed" ? 422 : 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create ASP job.";
      return aspError(message, 400);
    }
  });
}
