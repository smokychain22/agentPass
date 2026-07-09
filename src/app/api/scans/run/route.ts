import { NextResponse } from "next/server";
import { RunScanDirectBodySchema } from "@/lib/scanner/types";
import { runBasicScan } from "@/lib/scanner/run-scan";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = RunScanDirectBodySchema.parse(await request.json());
    const scan = await runBasicScan(body.repoUrl, body.branch);

    return NextResponse.json({ success: true, scan });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
