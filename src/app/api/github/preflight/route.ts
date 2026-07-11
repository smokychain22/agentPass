import { NextResponse } from "next/server";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { runGitHubPreflight } from "@/lib/github-app/preflight";
import { parseRepositoryFullName } from "@/lib/github-app/repository";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json()) as {
    repositoryFullName?: string;
    branch?: string;
    scanId?: string;
    commitSha?: string;
  };

  if (!body.repositoryFullName?.trim()) {
    return NextResponse.json(
      { ok: false, error: "repositoryFullName is required." },
      { status: 422 }
    );
  }

  try {
    parseRepositoryFullName(body.repositoryFullName);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Invalid repositoryFullName.",
      },
      { status: 422 }
    );
  }

  const sessionKey = await buildSessionKey(request);
  const result = await runGitHubPreflight({
    repositoryFullName: body.repositoryFullName.trim(),
    branch: body.branch,
    scanId: body.scanId,
    commitSha: body.commitSha,
    sessionKey,
  });

  return NextResponse.json({ ok: true, ...result });
}
