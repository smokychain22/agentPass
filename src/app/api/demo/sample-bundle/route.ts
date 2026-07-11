import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import {
  ensureDemoArtifacts,
  generateDemoArtifacts,
  getDemoBundlePath,
} from "@/lib/demo/generate-demo-artifacts";
import { SAMPLE_BUNDLE_LABEL } from "@/lib/demo/constants";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const regenerate = url.searchParams.get("regenerate") === "1";

  try {
    if (regenerate) {
      await generateDemoArtifacts();
    } else {
      await ensureDemoArtifacts();
    }

    const bundlePath = getDemoBundlePath();
    const zipBuffer = await fs.readFile(bundlePath);

    return new NextResponse(zipBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="repodiet-demo-sample-bundle.zip"',
        "X-RepoDiet-Bundle-Source": SAMPLE_BUNDLE_LABEL,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate sample bundle.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
