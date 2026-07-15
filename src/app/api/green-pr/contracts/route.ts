import { NextResponse } from "next/server";
import { planMaintenanceContract, saveMaintenanceContract } from "@/lib/green-pr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const proposal = planMaintenanceContract(body.contract ?? body);
    const record = await saveMaintenanceContract(proposal.contractRecord);
    return NextResponse.json(
      {
        success: true,
        role: proposal.role,
        contractId: record.contractId,
        contractDigest: record.contractDigest,
        status: record.status,
        contract: record.contract,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Maintenance contract is invalid.",
      },
      { status: 422 }
    );
  }
}
