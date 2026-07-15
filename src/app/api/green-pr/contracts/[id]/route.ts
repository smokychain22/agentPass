import { NextResponse } from "next/server";
import { getMaintenanceContract } from "@/lib/green-pr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const contract = await getMaintenanceContract(id);
  if (!contract) {
    return NextResponse.json(
      { success: false, error: "Maintenance contract not found." },
      { status: 404 }
    );
  }
  return NextResponse.json(
    { success: true, ...contract },
    { headers: { "Cache-Control": "no-store" } }
  );
}
