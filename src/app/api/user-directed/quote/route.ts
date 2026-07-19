import { NextResponse } from "next/server";
import {
  assertQuoteMatchesPlan,
  createDynamicSignedQuote,
  rejectClientModifiedPrice,
} from "@/lib/user-directed/dynamic-quote-engine";
import type {
  PaymentChannelChoice,
  TransformationPlan,
} from "@/lib/user-directed/types";
import { resolveCommercePrice } from "@/lib/pricing/commerce-price";

export const runtime = "nodejs";

/**
 * Create a dynamic signed quote bound to an executable TransformationPlan.
 * Rejects quotes without a real patch / plan hash.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      plan: TransformationPlan;
      paymentChannel?: PaymentChannelChoice;
      clientAmountAtomic?: string;
    };

    if (!body.plan?.planId || !body.plan.planHash) {
      return NextResponse.json({ ok: false, error: "Transformation plan is required." }, { status: 400 });
    }

    const paymentChannel = body.paymentChannel ?? "direct_website";
    const quote = createDynamicSignedQuote({
      plan: body.plan,
      paymentChannel,
    });

    assertQuoteMatchesPlan(quote, body.plan);
    rejectClientModifiedPrice({
      quote,
      clientAmountAtomic: body.clientAmountAtomic,
    });

    // Keep commerce resolver aligned for downstream createBoundQuote callers.
    const commerce = resolveCommercePrice("verified_cleanup_pr", {
      dynamicAmountMicro: quote.amountAtomic,
      pathCount: body.plan.selectedRepositoryPaths.length,
      proposedAction: body.plan.proposedAction,
    });

    return NextResponse.json({
      ok: true,
      quote,
      commercePrice: commerce,
      boundToPlanHash: quote.planHash === body.plan.planHash,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Dynamic quote failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
