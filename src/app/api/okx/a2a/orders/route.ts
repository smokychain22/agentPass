import { NextResponse } from "next/server";
import { createA2aOrder } from "@/lib/okx/a2a-adapter";
import type { A2aServiceId } from "@/lib/okx/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      serviceId: A2aServiceId;
      repoUrl: string;
      branch?: string;
      commitSha?: string;
      findingIds?: string[];
      quoteId?: string;
      escrowReference?: string;
      callbackUrl?: string;
      contractId?: string;
      contractDigest?: string;
    };

    if (!body.serviceId || !body.repoUrl) {
      return NextResponse.json(
        { success: false, error: "serviceId and repoUrl are required." },
        { status: 400 }
      );
    }

    const result = await createA2aOrder(body);
    const status = result.ok ? 201 : 422;
    return NextResponse.json(result, { status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Order creation failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
