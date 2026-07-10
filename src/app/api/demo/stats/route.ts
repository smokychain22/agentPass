import { NextResponse } from "next/server";
import {
  ensureDemoArtifacts,
  generateDemoArtifacts,
  readDemoScanStats,
} from "@/lib/demo/generate-demo-artifacts";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";

  try {
    const stats = refresh
      ? (await generateDemoArtifacts()).stats
      : (await readDemoScanStats()) ?? (await ensureDemoArtifacts());
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load demo stats.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
