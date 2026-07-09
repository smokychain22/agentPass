import { NextResponse } from "next/server";
import { getStoredPatchKit } from "@/lib/patch-kit/patch-kit-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const stored = getStoredPatchKit(id);

  if (!stored) {
    return NextResponse.json(
      { success: false, error: "Patch kit not found or expired." },
      { status: 404 }
    );
  }

  return new NextResponse(new Uint8Array(stored.zipBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${stored.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
