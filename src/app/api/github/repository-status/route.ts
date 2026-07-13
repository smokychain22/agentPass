import { NextResponse } from "next/server";
import { resolveRepositoryConnectionStatus } from "@/lib/workflow/github-repository-status";
import { buildSessionKey } from "@/lib/github-app/browser-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const repository = url.searchParams.get("repository");
  const branch = url.searchParams.get("branch") ?? undefined;
  const commitSha = url.searchParams.get("commitSha") ?? undefined;

  if (!repository) {
    return NextResponse.json({ ok: false, error: "repository is required." }, { status: 400 });
  }

  const sessionKey = await buildSessionKey(request);
  const status = await resolveRepositoryConnectionStatus({
    repository,
    branch,
    commitSha,
    sessionKey: sessionKey ?? undefined,
  });

  return NextResponse.json({ ok: true, ...status });
}
