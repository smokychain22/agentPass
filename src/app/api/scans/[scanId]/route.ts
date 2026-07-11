import { NextResponse } from "next/server";
import { getAppScan } from "@/lib/scan/app-scan-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ scanId: string }> }
) {
  const { scanId } = await params;
  const record = await getAppScan(scanId);
  if (!record) {
    return NextResponse.json({ success: false, error: "Scan not found." }, { status: 404 });
  }
  return NextResponse.json({ success: true, scan: record.payload });
}
