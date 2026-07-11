import { NextResponse } from "next/server";
import { runPatchKitEngine } from "@/lib/patch-kit/patch-kit-engine";
import { PatchKitGenerateBodySchema } from "@/lib/patch-kit/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = PatchKitGenerateBodySchema.parse(await request.json());
    const patchKit = await runPatchKitEngine(body);

    return NextResponse.json({ success: true, patchKit });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Patch kit generation failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
