import { NextRequest, NextResponse } from "next/server";
import { resolveAuthoritativeRepositoryAccess } from "@/lib/github-app/authoritative-repository-access";

export const runtime = "nodejs";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
};

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const owner = url.searchParams.get("owner")?.trim();
  const repo = url.searchParams.get("repo")?.trim();
  const installationIdRaw =
    url.searchParams.get("installation_id") ??
    url.searchParams.get("github_installation_id");
  const installationIdHint = installationIdRaw ? Number(installationIdRaw) : undefined;

  if (!owner || !repo) {
    return NextResponse.json(
      { ok: false, error: "owner and repo query parameters are required." },
      { status: 400, headers: NO_STORE }
    );
  }

  const result = await resolveAuthoritativeRepositoryAccess({
    owner,
    repo,
    installationIdHint:
      installationIdHint && Number.isFinite(installationIdHint)
        ? installationIdHint
        : undefined,
    expectedAccount: owner,
  });

  return NextResponse.json(
    {
      ok: true,
      ...result,
    },
    { headers: NO_STORE }
  );
}
