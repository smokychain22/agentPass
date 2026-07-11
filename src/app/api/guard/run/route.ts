import { NextResponse } from "next/server";
import { activateRepoGuard, runManualGuardScan } from "@/lib/guard/guard-engine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: "activate" | "scan";
      repoUrl?: string;
      repository?: string;
      branch?: string;
      quoteId?: string;
      paymentReference?: string;
      installationId?: string;
      callbackUrl?: string;
      protectedPaths?: string[];
    };

    if (body.action === "activate" || body.repoUrl) {
      if (!body.repoUrl) {
        return NextResponse.json({ success: false, error: "repoUrl is required." }, { status: 400 });
      }
      const result = await activateRepoGuard({
        repoUrl: body.repoUrl,
        branch: body.branch,
        quoteId: body.quoteId,
        paymentReference: body.paymentReference,
        installationId: body.installationId,
        callbackUrl: body.callbackUrl,
        protectedPaths: body.protectedPaths,
      });
      return NextResponse.json({
        success: true,
        subscription: result.subscription,
        baselineRun: {
          id: result.baselineRun.id,
          status: result.baselineRun.status,
          currentScanId: result.baselineRun.currentScanId,
          proposal: result.baselineRun.proposal,
        },
      });
    }

    const repository = body.repository;
    if (!repository) {
      return NextResponse.json(
        { success: false, error: "repository or repoUrl is required." },
        { status: 400 }
      );
    }

    const run = await runManualGuardScan(repository);
    return NextResponse.json({ success: true, run });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Guard run failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
