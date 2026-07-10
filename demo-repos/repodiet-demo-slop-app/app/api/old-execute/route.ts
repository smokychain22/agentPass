import { NextResponse } from "next/server";

// FIXME: old execute endpoint — orphaned API experiment
export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json({ ok: true, plan: body, route: "old-execute" });
}
