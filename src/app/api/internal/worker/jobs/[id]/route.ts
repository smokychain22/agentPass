import { NextResponse } from "next/server";
import { getRepositoryJob } from "@/lib/worker/repository-job-store";
import { assertWorkerAuthorized } from "@/lib/worker/worker-auth";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertWorkerAuthorized(request);
    const { id } = await context.params;
    const job = await getRepositoryJob(id);
    if (!job) {
      return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fetch failed.";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message.includes("Unauthorized") ? 401 : 500 }
    );
  }
}
