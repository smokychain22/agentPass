import { NextResponse } from "next/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { jobOwnerKey } from "@/lib/jobs/types";
import { executeTaskQuote } from "@/lib/execution";
import type { TaskOperation } from "@/lib/execution/task-quote";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ownerKey = jobOwnerKey(request);
    await enforceRateLimit(ownerKey, "scan");

    const body = (await request.json()) as {
      repository: string;
      branch?: string;
      commitSha: string;
      findingIds?: string[];
      operation: TaskOperation;
      sourceFileCount?: number;
    };

    if (!body.repository || !body.commitSha || !body.operation) {
      return NextResponse.json(
        { success: false, error: "repository, commitSha, and operation are required." },
        { status: 400 }
      );
    }

    const quote = await executeTaskQuote({
      repository: body.repository,
      branch: body.branch ?? "main",
      commitSha: body.commitSha,
      findingIds: body.findingIds ?? [],
      operation: body.operation,
      sourceFileCount: body.sourceFileCount,
    });

    return NextResponse.json({ success: true, quote });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    const message = err instanceof Error ? err.message : "Quote failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
