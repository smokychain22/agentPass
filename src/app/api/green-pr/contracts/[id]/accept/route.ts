import { NextResponse } from "next/server";
import { acceptMaintenanceContract } from "@/lib/green-pr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const contractDigest =
      typeof body.contractDigest === "string" ? body.contractDigest.trim() : "";
    if (!contractDigest) {
      return NextResponse.json(
        { success: false, error: "contractDigest is required." },
        { status: 400 }
      );
    }
    const contract = await acceptMaintenanceContract(id, contractDigest);
    return NextResponse.json(
      {
        success: true,
        contractId: contract.contractId,
        contractDigest: contract.contractDigest,
        status: contract.status,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Contract acceptance failed.",
      },
      { status: 409 }
    );
  }
}
