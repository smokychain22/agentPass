import { NextResponse } from "next/server";
import { getGreenPrAttestation } from "@/lib/green-pr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const attestation = await getGreenPrAttestation(id);
  if (!attestation) {
    return NextResponse.json(
      { success: false, error: "Green PR attestation not found." },
      { status: 404 }
    );
  }
  return NextResponse.json(
    { success: true, attestation },
    { headers: { "Cache-Control": "no-store" } }
  );
}
