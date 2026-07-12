import { NextResponse } from "next/server";
import { retrySandboxRun } from "@/lib/execution/sandbox-run-store";
import { startRepositoryCleanupExecution } from "@/lib/execution/start-cleanup-workflow";
import { getStoredPatchKit } from "@/lib/patch-kit/patch-kit-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { cleanupRunId?: string };
    const cleanupRunId = body.cleanupRunId?.trim();
    if (!cleanupRunId) {
      return NextResponse.json({ ok: false, error: "cleanupRunId is required." }, { status: 400 });
    }

    const stored = await getStoredPatchKit(cleanupRunId);
    if (!stored?.payload) {
      return NextResponse.json({ ok: false, error: "Cleanup run not found." }, { status: 404 });
    }

    const run = await retrySandboxRun(cleanupRunId);
    if (!run) {
      return NextResponse.json({ ok: false, error: "No retryable sandbox run." }, { status: 404 });
    }

    const ops = stored.payload.changeOperations ?? [];
    const edits =
      stored.payload.validatedEdits?.length
        ? stored.payload.validatedEdits
        : ops.map((op) => ({
            path: op.filePath,
            content: op.afterContent ?? "",
          }));

    const execution = await startRepositoryCleanupExecution({
      cleanupRunId,
      scanId: stored.payload.scanId,
      repositoryOwner: stored.payload.repo.owner,
      repositoryName: stored.payload.repo.name,
      branch: stored.payload.repo.branch,
      baseCommitSha: stored.payload.patchValidation?.baseCommitSha ?? "unknown",
      repoUrl: `https://github.com/${stored.payload.repo.owner}/${stored.payload.repo.name}`,
      edits,
      changeOperations: ops,
      patch: stored.payload.artifacts.cleanupPatch,
    });

    return NextResponse.json({ ok: true, run, ...execution });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Retry failed.";
    const code = message.includes("SANDBOX_UNAVAILABLE") ? "SANDBOX_UNAVAILABLE" : "RETRY_FAILED";
    return NextResponse.json({ ok: false, code, error: message }, { status: 503 });
  }
}
