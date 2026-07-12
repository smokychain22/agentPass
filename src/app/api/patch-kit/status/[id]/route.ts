import { NextResponse } from "next/server";
import { getStoredPatchKit } from "@/lib/patch-kit/patch-kit-store";
import { getSandboxRunByCleanupRunId } from "@/lib/execution/sandbox-run-store";
import {
  isTerminalSandboxStatus,
  reconcileSandboxRun,
} from "@/lib/execution/reconcile-sandbox-run";
import { isPublicGitHubRepository } from "@/lib/github/fetch-repo-zip";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const sandboxRun = await getSandboxRunByCleanupRunId(id);
    if (sandboxRun) {
      await reconcileSandboxRun(sandboxRun);
    }

    const stored = await getStoredPatchKit(id);
    if (!stored?.payload) {
      return NextResponse.json({ ok: false, error: "Patch kit not found." }, { status: 404 });
    }

    let patchKit = stored.payload;
    if (patchKit.repositoryIsPublic === undefined) {
      patchKit = {
        ...patchKit,
        repositoryIsPublic: await isPublicGitHubRepository(
          patchKit.repo.owner,
          patchKit.repo.name
        ),
      };
    }

    const run = sandboxRun ? await reconcileSandboxRun(sandboxRun) : undefined;

    return NextResponse.json({
      ok: true,
      patchKit,
      sandboxRun: run
        ? {
            id: run.id,
            status: run.status,
            progress: run.progress,
            terminal: isTerminalSandboxStatus(run.status),
            failureCode: run.failureCode,
            failureMessage: run.failureMessage,
          }
        : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load patch kit status.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
