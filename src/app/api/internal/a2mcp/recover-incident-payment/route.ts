import { NextResponse } from "next/server";
import { runPhase3ToolRoute } from "@/lib/a2mcp/phase3-route";
import { executeQuickTriage } from "@/lib/a2mcp/quick-triage-engine";
import { buildToolErrorResponse } from "@/lib/a2mcp/tool-contract";
import { createTaskId } from "@/lib/a2mcp/task-store";
import {
  INCIDENT_PAYMENT_REFERENCE,
  INCIDENT_QUOTE_ID,
  INCIDENT_REQUEST_DIGEST,
} from "@/lib/a2mcp/quick-triage-budget";
import { getBoundQuote } from "@/lib/payment/payment-store";
import { repairMisConsumedQuote } from "@/lib/payment/quote-repair";
import { verifyOnchainUsdtTransfer } from "@/lib/payment/onchain-usdt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 25;

function recoveryAllowed(request: Request): boolean {
  const secret = process.env.REPODIET_INTERNAL_DIAGNOSTIC_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("x-repodiet-diagnostic-secret") === secret;
}

export async function POST(request: Request) {
  const taskId = createTaskId();
  if (!recoveryAllowed(request)) {
    return NextResponse.json(
      buildToolErrorResponse(
        "analyze_repository",
        taskId,
        "INVALID_INPUT",
        "Incident recovery is disabled."
      ),
      { status: 403 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      buildToolErrorResponse("analyze_repository", taskId, "INVALID_INPUT", "Invalid JSON."),
      { status: 400 }
    );
  }

  const quoteId = typeof body.quoteId === "string" ? body.quoteId.trim() : INCIDENT_QUOTE_ID;
  const paymentReference =
    typeof body.paymentReference === "string"
      ? body.paymentReference.trim()
      : INCIDENT_PAYMENT_REFERENCE;
  const requestDigest =
    typeof body.requestDigest === "string" ? body.requestDigest.trim() : INCIDENT_REQUEST_DIGEST;

  if (
    quoteId !== INCIDENT_QUOTE_ID ||
    paymentReference.toLowerCase() !== INCIDENT_PAYMENT_REFERENCE.toLowerCase() ||
    requestDigest !== INCIDENT_REQUEST_DIGEST
  ) {
    return NextResponse.json(
      buildToolErrorResponse(
        "analyze_repository",
        taskId,
        "INVALID_INPUT",
        "Recovery limited to the verified incident quote, digest, and transaction."
      ),
      { status: 400 }
    );
  }

  const quote = await getBoundQuote(quoteId);
  if (!quote) {
    return NextResponse.json(
      buildToolErrorResponse("analyze_repository", taskId, "INVALID_INPUT", "Incident quote not found."),
      { status: 404 }
    );
  }

  const onchain = await verifyOnchainUsdtTransfer({
    txHash: paymentReference,
    payer: quote.payer ?? "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
    recipient: quote.recipient,
    amountMicro: quote.amountMicro,
    tokenAddress: quote.asset,
    network: quote.network,
  });
  if (!onchain.ok) {
    return NextResponse.json(
      buildToolErrorResponse(
        "analyze_repository",
        taskId,
        "INVALID_INPUT",
        onchain.reason ?? "On-chain payment verification failed."
      ),
      { status: 422 }
    );
  }

  await repairMisConsumedQuote(quoteId);

  const repositoryUrl =
    (typeof body.repositoryUrl === "string" && body.repositoryUrl.trim()) ||
    (typeof body.repoUrl === "string" && body.repoUrl.trim()) ||
    `https://github.com/${quote.repository}`;

  const forwardedBody = {
    repoUrl: repositoryUrl,
    repositoryUrl,
    branch: typeof body.branch === "string" ? body.branch : quote.branch,
    maximumFindings: 5,
    quoteId,
    paymentReference,
    payer: quote.payer,
    operation: "analyze_repository",
    source: "incident_recovery",
  };

  const forwardedRequest = new Request(request.url, {
    method: "POST",
    headers: {
      ...Object.fromEntries(request.headers.entries()),
      "x-repodiet-quote-id": quoteId,
      "x-payment-reference": paymentReference,
    },
    body: JSON.stringify(forwardedBody),
  });

  return runPhase3ToolRoute("analyze_repository", forwardedRequest, executeQuickTriage);
}
