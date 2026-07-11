import { NextResponse } from "next/server";
import { getPatchKitByScanId } from "@/lib/patch-kit/patch-kit-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ scanId: string }> }
) {
  const { scanId } = await params;
  const stored = await getPatchKitByScanId(scanId);
  if (!stored) {
    return NextResponse.json({ success: false, error: "Patch kit not found for scan." }, { status: 404 });
  }
  return NextResponse.json({ success: true, patchKit: stored.payload });
}
