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
      { success: false, error: result.reason ?? "Invalid receipt." },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true, receipt: result.receipt });
}
