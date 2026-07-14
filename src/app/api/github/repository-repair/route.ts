import { NextResponse } from "next/server";
import { isGitHubAppConfigured } from "@/lib/github-app/config";
import {
  applyMeridianBaselineRepair,
  MERIDIAN_BASELINE_REPAIR_ID,
} from "@/lib/github/repository-repair";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!isGitHubAppConfigured()) {
    return NextResponse.json(
      { ok: false, error: "GitHub App is not configured on this deployment." },
      { status: 503 }
    );
  }

  const body = (await request.json()) as {
    owner?: string;
    repo?: string;
    repairId?: string;
  };

  const owner = body.owner?.trim();
  const repo = body.repo?.trim();
  const repairId = body.repairId?.trim() ?? MERIDIAN_BASELINE_REPAIR_ID;

  if (!owner || !repo) {
    return NextResponse.json(
      { ok: false, error: "owner and repo are required." },
      { status: 400 }
    );
  }

  try {
    const result = await applyMeridianBaselineRepair({ owner, repo, repairId });
    if (!result.ok) {
      return NextResponse.json(result, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Repository repair failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
