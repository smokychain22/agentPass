import { NextResponse } from "next/server";
import { resolveRepositoryConnectionStatus } from "@/lib/workflow/github-repository-status";
import { buildSessionKey } from "@/lib/github-app/browser-session";

export const runtime = "nodejs";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const repository = url.searchParams.get("repository");
  const branch = url.searchParams.get("branch") ?? undefined;
  const commitSha = url.searchParams.get("commitSha") ?? undefined;
  const installationIdRaw =
    url.searchParams.get("installation_id") ?? url.searchParams.get("github_installation_id");
  const installationIdHint = installationIdRaw ? Number(installationIdRaw) : undefined;

  if (!repository) {
    return NextResponse.json(
      { ok: false, error: "repository is required." },
      { status: 400, headers: NO_STORE }
    );
  }

  const sessionKey = await buildSessionKey(request);
  const status = await resolveRepositoryConnectionStatus({
    repository,
    branch,
    commitSha,
    sessionKey: sessionKey ?? undefined,
    installationIdHint:
      installationIdHint && Number.isFinite(installationIdHint)
        ? installationIdHint
        : undefined,
  });

  return NextResponse.json({ ok: true, ...status }, { headers: NO_STORE });
}
