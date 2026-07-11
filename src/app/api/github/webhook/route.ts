import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getGitHubAppConfig } from "@/lib/github-app/config";
import { processGitHubWebhookEvent } from "@/lib/guard/guard-engine";

export const runtime = "nodejs";

function verifyGitHubSignature(payload: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const provided = signature.slice("sha256=".length);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON." }, { status: 400 });
  }

  const event = request.headers.get("x-github-event") ?? "unknown";
  const testMode =
    process.env.REPODIET_GUARD_TEST_MODE === "1" ||
    request.headers.get("x-repodiet-guard-test") === "1";

  if (!testMode) {
    const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
    if (secret) {
      const sig = request.headers.get("x-hub-signature-256");
      if (!verifyGitHubSignature(rawBody, sig, secret)) {
        return NextResponse.json({ success: false, error: "Invalid signature." }, { status: 401 });
      }
    } else {
      try {
        const cfg = getGitHubAppConfig();
        if (cfg.webhookSecret) {
          const sig = request.headers.get("x-hub-signature-256");
          if (!verifyGitHubSignature(rawBody, sig, cfg.webhookSecret)) {
            return NextResponse.json({ success: false, error: "Invalid signature." }, { status: 401 });
          }
        }
      } catch {
        if (process.env.REQUIRE_REAL_X402 === "1") {
          return NextResponse.json(
            { success: false, error: "Webhook secret not configured." },
            { status: 503 }
          );
        }
      }
    }
  }

  const result = await processGitHubWebhookEvent(event, payload);
  return NextResponse.json({
    success: true,
    event,
    handled: result.handled,
    reason: result.reason,
    run: result.run
      ? {
          id: result.run.id,
          status: result.run.status,
          trigger: result.run.trigger,
          commitSha: result.run.commitSha,
          skipReason: result.run.skipReason,
          delta: result.run.delta
            ? {
                newCount: result.run.delta.newFindings.length,
                resolvedCount: result.run.delta.resolvedFindings.length,
                ignoredCount: result.run.delta.ignoredFindings.length,
                presentedCount: result.run.delta.newFindings.length,
              }
            : null,
          proposal: result.run.proposal,
          notification: result.run.notification,
        }
      : undefined,
  });
}
