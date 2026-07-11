import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json({ ok: true, plan: body, route: "execute/plan" });
}
