import { NextResponse } from "next/server";
import { getGreenPrReceipt } from "@/lib/green-pr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const receipt = await getGreenPrReceipt(id);
  if (!receipt) {
    return NextResponse.json(
      { success: false, error: "Green PR receipt not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(
    { success: true, receipt },
    { headers: { "Cache-Control": "no-store" } }
  );
}
