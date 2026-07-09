import { NextResponse } from "next/server";
import { getScan } from "@/lib/scanner/store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const record = getScan(id);

  if (!record) {
    return NextResponse.json(
      { ok: false, error: "Scan not found." },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, data: record });
}
