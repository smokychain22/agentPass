import { NextResponse } from "next/server";
import { assertWorkerAuthorized, WorkerAuthError } from "@/lib/worker/worker-auth";
import { createFreshGitHubInstallationToken } from "@/lib/execution/sandbox-github-token";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertWorkerAuthorized(request);
    const body = (await request.json()) as {
      repositoryId?: string;
      installationId?: number;
      jobId?: string;
      repositoryOwner?: string;
      repositoryName?: string;
    };

    const owner = body.repositoryOwner?.trim();
    const name = body.repositoryName?.trim();
    if (!owner || !name) {
      const repoId = body.repositoryId?.trim();
      if (repoId?.includes("/")) {
        const [o, n] = repoId.split("/");
        if (o && n) {
          const token = await createFreshGitHubInstallationToken({
            repositoryOwner: o,
            repositoryName: n,
            installationId: body.installationId,
            jobId: body.jobId,
          });
          return NextResponse.json({
            ok: true,
            token: token.token,
            expiresAt: token.expiresAt,
            installationId: token.installationId,
          });
        }
      }
      return NextResponse.json({ ok: false, error: "repositoryOwner and repositoryName are required." }, { status: 400 });
    }

    const token = await createFreshGitHubInstallationToken({
      repositoryOwner: owner,
      repositoryName: name,
      installationId: body.installationId,
      jobId: body.jobId,
    });

    return NextResponse.json({
      ok: true,
      token: token.token,
      expiresAt: token.expiresAt,
      installationId: token.installationId,
    });
  } catch (err) {
    if (err instanceof WorkerAuthError) {
      return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Token request failed.";
    const code = message.includes("NOT_FOUND")
      ? "JOB_NOT_FOUND"
      : message.includes("MISMATCH")
        ? "JOB_REPOSITORY_MISMATCH"
        : message.includes("NOT_CONNECTED")
          ? "GITHUB_APP_NOT_CONNECTED"
          : message.includes("NOT_GRANTED") || message.includes("PERMISSION")
            ? "GITHUB_PERMISSION_DENIED"
            : "TOKEN_REQUEST_FAILED";
    return NextResponse.json({ ok: false, code, error: message }, { status: code === "JOB_NOT_FOUND" ? 404 : 403 });
  }
}
