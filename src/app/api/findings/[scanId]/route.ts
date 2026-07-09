import { NextResponse } from "next/server";
import { getStoredFindings } from "@/lib/findings/findings-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ scanId: string }> }
) {
  const { scanId } = await params;
  const findings = getStoredFindings(scanId);

  if (!findings) {
    return NextResponse.json(
      { success: false, error: "Findings not found for this scan ID." },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, findings });
}
