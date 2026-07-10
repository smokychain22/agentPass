import { NextResponse } from "next/server";
import { listOkxServices } from "@/lib/okx/services";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    asp: "RepoDiet",
    serviceTypes: ["A2MCP", "A2A"],
    services: listOkxServices(),
  });
}
