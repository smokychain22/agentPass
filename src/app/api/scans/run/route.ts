import { NextResponse } from "next/server";
import { RunScanBodySchema } from "@/lib/scanner/types";
import { getScan } from "@/lib/scanner/store";
import { executeScan } from "@/lib/scanner/run-scan";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = RunScanBodySchema.parse(await request.json());
    const record = getScan(body.id);

    if (!record) {
      return NextResponse.json(
        { ok: false, error: "Scan not found." },
        { status: 404 }
      );
    }

    if (record.status === "complete" && record.result) {
      return NextResponse.json({ ok: true, data: record });
    }

    const result = await executeScan(body.id);
    const updated = getScan(body.id);

    return NextResponse.json({
      ok: true,
      data: updated ?? { ...record, status: "complete", result },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
