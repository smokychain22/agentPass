import { NextResponse } from "next/server";

// TODO: experimental execute-plan route — duplicate of execute/plan
export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json({ ok: true, plan: body, route: "execute-plan" });
}
