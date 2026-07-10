import { NextResponse } from "next/server";
import {
  getBoundQuote,
  paymentProofFromRequest,
  signTestPaymentPayload,
  verifyAndFundQuote,
} from "@/lib/payment";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    let proof = paymentProofFromRequest(request, body);

    if (!proof) {
      return NextResponse.json({ success: false, error: "quoteId is required." }, { status: 400 });
    }

    const quote = await getBoundQuote(proof.quoteId);
    if (!quote) {
      return NextResponse.json({ success: false, error: "Quote not found." }, { status: 404 });
    }

    proof = {
      ...proof,
      amountMicro: quote.amountMicro,
      currency: quote.currency,
      network: quote.network,
      recipient: quote.recipient,
      nonce: quote.nonce,
    };

    if (!proof.paymentSignature && process.env.REPODIET_X402_TEST_SECRET) {
      proof.paymentSignature =
        signTestPaymentPayload({
          quoteId: proof.quoteId,
          paymentReference: proof.paymentReference,
          payer: proof.payer,
          amountMicro: proof.amountMicro,
          nonce: proof.nonce,
          requestHash: quote.requestHash,
        }) ?? undefined;
    }

    const result = await verifyAndFundQuote(proof);
    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          status: result.status,
          error: result.reason,
          existingTaskId: result.existingTaskId,
        },
        { status: result.status === "replayed" ? 409 : 402 }
      );
    }

    return NextResponse.json({
      success: true,
      status: result.status,
      quote: result.quote,
      existingTaskId: result.existingTaskId,
      lifecycleStatus: result.quote?.lifecycleStatus,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Payment verification failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
