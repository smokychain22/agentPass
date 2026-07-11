import { NextResponse } from "next/server";
import { createCleanupPullRequest } from "@/lib/operator/create-cleanup-pr";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { getStoredPatchKit, getPatchKitByScanId } from "@/lib/patch-kit/patch-kit-store";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { ToolExecutionError } from "@/lib/a2mcp/errors";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      cleanupRunId?: string;
      patchKitId?: string;
      scanId?: string;
      confirmation?: boolean;
      mode?: "safe_only" | "report_only";
      demo?: boolean;
      githubToken?: string;
    };

    if (body.confirmation !== true) {
      return NextResponse.json(
        { ok: false, error: "Explicit confirmation is required." },
        { status: 400 }
      );
    }

    const patchKit =
      (body.patchKitId ? await getStoredPatchKit(body.patchKitId) : undefined)?.payload ??
      (body.cleanupRunId ? await getStoredPatchKit(body.cleanupRunId) : undefined)?.payload ??
      (body.scanId ? await getPatchKitByScanId(body.scanId) : undefined)?.payload;

    if (!patchKit) {
      return NextResponse.json(
        { ok: false, error: "Cleanup run not found. Generate repairs in Quick Cleanup first." },
        { status: 404 }
      );
    }

    const findings =
      patchKit.artifacts.findingsJson ??
      (body.scanId ? await getStoredFindings(body.scanId) : undefined);

    if (!findings) {
      return NextResponse.json(
        { ok: false, error: "Findings snapshot missing for cleanup run." },
        { status: 404 }
      );
    }

    if (
      body.mode !== "report_only" &&
      (patchKit.summary.verifiedChanges ?? 0) === 0
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            patchKit.repositoryVerification?.status === "blocked"
              ? "Repository verification is blocked — cleanup PR cannot be created yet."
              : "No verified source changes in cleanup run.",
        },
        { status: 422 }
      );
    }

    if (
      body.mode !== "report_only" &&
      patchKit.patchValidation?.status === "pending_sandbox"
    ) {
      return NextResponse.json(
        {
          ok: false,
          code: "SANDBOX_EXECUTION_PENDING",
          error: "Waiting for repository verification in Vercel Sandbox.",
        },
        { status: 422 }
      );
    }

    if (
      body.mode !== "report_only" &&
      patchKit.patchValidation?.status === "blocked"
    ) {
      return NextResponse.json(
        {
          ok: false,
          code: "GIT_PATCH_VALIDATION_REQUIRED",
          error:
            "Real Git patch validation must pass before PR delivery. A Docker worker must complete git apply --check and repository verification.",
        },
        { status: 422 }
      );
    }

    if (
      body.mode !== "report_only" &&
      patchKit.patchValidation?.status !== "passed"
    ) {
      return NextResponse.json(
        { ok: false, error: "Patch validation must pass before creating a cleanup PR." },
        { status: 422 }
      );
    }

    if (
      body.mode !== "report_only" &&
      (patchKit.summary.validatedChanges ?? 0) === 0 &&
      (patchKit.validatedEdits?.length ?? 0) === 0
    ) {
      return NextResponse.json(
        { ok: false, error: "No validated source changes in cleanup run." },
        { status: 422 }
      );
    }

    const repoUrl = `https://github.com/${patchKit.repo.owner}/${patchKit.repo.name}`;
    const sessionKey = await buildSessionKey(request);
    const result = await createCleanupPullRequest({
      repoUrl,
      branch: patchKit.repo.branch,
      findings,
      patchKit,
      mode: body.mode ?? "safe_only",
      demo: body.demo,
      githubToken: body.githubToken,
      sessionKey,
    });

    return NextResponse.json({
      ok: true,
      pullRequest: result.data.pullRequest,
      repo: result.data.repo,
      actionSummary: result.data.actionSummary,
      warnings: result.warnings,
    });
  } catch (err) {
    if (err instanceof ToolExecutionError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.status }
      );
    }
    const message = err instanceof Error ? err.message : "Cleanup PR creation failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
