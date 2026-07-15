import { NextResponse } from "next/server";
import {
  getGreenPrReceipt,
  getMaintenanceContractByDigest,
  trustedKeyMapFromEnvironment,
  verifyGreenPrReceipt,
} from "@/lib/green-pr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const receiptId = typeof body.receiptId === "string" ? body.receiptId.trim() : "";
  if (!receiptId) {
    return NextResponse.json({ success: false, error: "receiptId is required." }, { status: 400 });
  }
  const receipt = await getGreenPrReceipt(receiptId);
  if (!receipt) {
    return NextResponse.json({ success: false, error: "Green PR receipt not found." }, { status: 404 });
  }
  const contract = await getMaintenanceContractByDigest(receipt.payload.contractDigest);
  if (!contract) {
    return NextResponse.json({ success: false, error: "Bound maintenance contract not found." }, { status: 404 });
  }
  const trustedPublicKeys = trustedKeyMapFromEnvironment("RECEIPT");
  if (Object.keys(trustedPublicKeys).length === 0) {
    return NextResponse.json(
      { success: false, error: "Receipt verification trust root is not configured." },
      { status: 503 }
    );
  }
  const result = verifyGreenPrReceipt(receipt, contract, trustedPublicKeys);
  return NextResponse.json(
    { success: result.valid, receiptId, contractDigest: contract.contractDigest, ...result },
    { status: result.valid ? 200 : 422, headers: { "Cache-Control": "no-store" } }
  );
}
