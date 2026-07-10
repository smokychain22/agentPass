import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/github-app/config";

export const runtime = "nodejs";

/** Legacy callback proxy — forwards to install/complete. */
export async function GET(request: NextRequest) {
  const target = new URL("/api/github/install/complete", getAppBaseUrl());
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    target.searchParams.set(key, value);
  }
  return NextResponse.redirect(target);
}
