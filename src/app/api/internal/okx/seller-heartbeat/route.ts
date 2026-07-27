import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { recordVerifiedAgentRuntimeHeartbeat } from "@/lib/a2a/agent-runtime-health";

export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const expected = process.env.REPODIET_OKX_RUNTIME_HEARTBEAT_SECRET?.trim();
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!expected || expected.length < 32 || !provided || expected.length !== provided.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, code: "RUNTIME_HEARTBEAT_UNAUTHORIZED" },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_HEARTBEAT_JSON" },
      { status: 400 }
    );
  }

  if (
    body.onchainOsAuthenticated !== true ||
    body.officialWatchActive !== true ||
    body.xmtpClientReady !== true
  ) {
    return NextResponse.json(
      { ok: false, code: "RUNTIME_HEARTBEAT_NOT_READY" },
      { status: 422 }
    );
  }

  try {
    const health = await recordVerifiedAgentRuntimeHeartbeat({
      aspAgentId: String(body.aspAgentId ?? ""),
      a2aServiceId: String(body.a2aServiceId ?? ""),
      sellerWallet: String(body.sellerWallet ?? ""),
      registeredCommunicationAddress: String(body.registeredCommunicationAddress ?? ""),
      recoveredSignerAddress: String(body.recoveredSignerAddress ?? ""),
      onchainOsAuthenticated: true,
      officialWatchActive: true,
      xmtpClientReady: true,
      ttlSeconds:
        typeof body.ttlSeconds === "number" && Number.isFinite(body.ttlSeconds)
          ? body.ttlSeconds
          : undefined,
      workerPid:
        typeof body.workerPid === "number" && Number.isFinite(body.workerPid)
          ? body.workerPid
          : undefined,
      duplicateWorkerAttemptCount:
        typeof body.duplicateWorkerAttemptCount === "number" &&
        Number.isFinite(body.duplicateWorkerAttemptCount)
          ? body.duplicateWorkerAttemptCount
          : undefined,
    });
    return NextResponse.json({
      ok: true,
      agentOnline: health.agentOnline,
      aspAgentId: health.aspAgentId,
      a2aServiceId: health.a2aServiceId,
      sellerWallet: health.sellerWallet,
      heartbeatStatus: health.heartbeatStatus,
      heartbeatExpiresAt: health.heartbeatExpiresAt,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code:
          error instanceof Error
            ? error.message.toUpperCase()
            : "RUNTIME_HEARTBEAT_REJECTED",
      },
      { status: 422 }
    );
  }
}
