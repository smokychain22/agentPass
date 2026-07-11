import { NextResponse } from "next/server";
import { buildOperatorProfile } from "@/lib/okx/operator-identity";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(buildOperatorProfile());
}
