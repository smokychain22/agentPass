import { NextResponse } from "next/server";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { flattenFindings } from "@/lib/findings/client";
import { runEligibilityPreflight } from "@/lib/workflow/eligibility-preflight";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      scanId?: string;
      repoUrl?: string;
      branch?: string;
      findingIds?: string[];
    };

    if (!body.scanId && !body.repoUrl) {
      return NextResponse.json(
        { ok: false, error: "scanId or repoUrl is required." },
        { status: 400 }
      );
    }

    let findings = body.scanId ? await getStoredFindings(body.scanId) : null;
    if (!findings && body.repoUrl) {
      const { runFindingsEngine } = await import("@/lib/findings/findings-engine");
      findings = await runFindingsEngine(body.repoUrl, body.branch);
    }
    if (!findings) {
      return NextResponse.json({ ok: false, error: "Findings not found." }, { status: 404 });
    }

    const flat = flattenFindings(findings);
    const results = await runEligibilityPreflight({
      repoUrl: body.repoUrl ?? `https://github.com/${findings.repo.owner}/${findings.repo.name}`,
      branch: body.branch ?? findings.repo.branch,
      findings: flat,
      findingIds: body.findingIds,
    });

    return NextResponse.json({
      ok: true,
      scanId: findings.scanId,
      commitSha: findings.repo.commitSha,
      results,
      summary: {
        ready: results.filter((r) => r.classification === "safe_candidate").length,
        reviewFirst: results.filter((r) => r.classification === "review_first").length,
        protected: results.filter((r) => r.classification === "protected").length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Eligibility preflight failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
