import { NextResponse } from "next/server";
import { clearInstallationSession } from "@/lib/github-app/session";

export const runtime = "nodejs";

export async function POST() {
  await clearInstallationSession();
  return NextResponse.json({ ok: true, connected: false });
}
