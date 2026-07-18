import { NextResponse } from "next/server";
import { bindOkxEscrowAndFund } from "@/lib/a2a/okx-escrow-fund";
import { formatA2ATaskResponse } from "@/lib/a2a/orchestrator";
import {
  buildPreviewDryRunDenial,
  isPreviewPaymentBlocked,
  PreviewDryRunError,
} from "@/lib/deployment/preview-dry-run";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Bind OKX A2A escrow funding reference and start cleanup execution.
 * Does not accept direct ERC-20 transfers to RepoDiet’s wallet.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;

  if (isPreviewPaymentBlocked()) {
    return NextResponse.json(buildPreviewDryRunDenial(), { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    escrowReference?: string;
    buyerWallet?: string;
    okxAuthorizationReference?: string;
  };

  if (!body.escrowReference?.trim() || !body.buyerWallet?.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: "escrowReference and buyerWallet are required from the OKX A2A escrow funding step.",
      },
      { status: 400 }
    );
  }

  try {
    const task = await bindOkxEscrowAndFund({
      taskId,
      escrowReference: body.escrowReference,
      buyerWallet: body.buyerWallet,
      okxAuthorizationReference: body.okxAuthorizationReference,
    });
    return NextResponse.json({
      success: true,
      taskId,
      status: task.status,
      settlement: task.result.settlement,
      task: formatA2ATaskResponse(task),
      paymentModel: "escrow",
      nextStep:
        task.status === "awaiting_payment"
          ? "Escrow binding incomplete — check the escrow reference on OKX.AI"
          : "Cleanup is running under OKX A2A escrow",
    });
  } catch (err) {
    if (err instanceof PreviewDryRunError) {
      return NextResponse.json(err.denial, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "OKX escrow funding failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
