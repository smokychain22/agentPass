import { NextResponse } from "next/server";
import { verifyReceipt } from "@/lib/okx/receipt-verifier";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ receiptId: string }> }
) {
  const { receiptId } = await context.params;
  const result = await verifyReceipt(receiptId);

  if (!result.valid) {
    return NextResponse.json(
      {
        success: false,
        valid: false,
        receiptId: result.receiptId ?? receiptId,
        operatorId: result.operatorId,
        signatureAlgorithm: result.signatureAlgorithm,
        receipt: result.receipt,
        error: result.reason ?? "Invalid receipt.",
      },
      { status: result.reason === "Receipt not found." ? 404 : 422 }
    );
  }

  return NextResponse.json({
    success: true,
    valid: true,
    receiptId: result.receiptId ?? receiptId,
    operatorId: result.operatorId,
    signatureAlgorithm: result.signatureAlgorithm,
    receipt: result.receipt,
  });
}
