import { NextResponse } from "next/server";
import {
  assertWorkerAuthorized,
  WorkerAuthError,
} from "@/lib/worker/worker-auth";
import {
  getLastStaleQueueReconciliationReport,
  reconcileStaleDeepScanQueue,
} from "@/lib/deep-scan/reconcile-stale";

export const runtime = "nodejs";
export const maxDuration = 60;

function diagnosticAuthorized(request: Request): boolean {
  const secret = process.env.REPODIET_INTERNAL_DIAGNOSTIC_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("x-repodiet-diagnostic-secret") === secret;
}

function authorize(request: Request): void {
  if (diagnosticAuthorized(request)) return;
  assertWorkerAuthorized(request);
}

/**
 * Inspect and reconcile stale deep-scan queue/capacity.
 * Never deletes completed evidence, receipts, attestations, or findings.
 * Never redispatches old jobs.
 */
export async function POST(request: Request) {
  try {
    authorize(request);
  } catch (err) {
    if (err instanceof WorkerAuthError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 401 }
      );
    }
    throw err;
  }

  let dryRun = false;
  try {
    const body = (await request.json()) as { dryRun?: boolean };
    dryRun = Boolean(body.dryRun);
  } catch {
    dryRun = false;
  }

  const report = await reconcileStaleDeepScanQueue({ apply: !dryRun });
  return NextResponse.json({
    ok: true,
    dryRun,
    ...report,
  });
}

export async function GET(request: Request) {
  try {
    authorize(request);
  } catch (err) {
    if (err instanceof WorkerAuthError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: 401 }
      );
    }
    throw err;
  }

  const report = await getLastStaleQueueReconciliationReport();
  return NextResponse.json({
    ok: true,
    report: report ?? null,
  });
}
