import { NextResponse } from "next/server";
import { createA2aOrder } from "@/lib/okx/a2a-adapter";
import type { A2aServiceId } from "@/lib/okx/types";
import { requirePinnedService } from "@/lib/okx-runtime/service-selection";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      serviceId: string;
      agentId?: string | number;
      serviceType?: string;
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

    requirePinnedService({
      protocol: "a2a",
      agentId: String(body.agentId ?? "5283"),
      serviceId: body.serviceId,
      serviceType: body.serviceType ?? "A2A",
    });
    const result = await createA2aOrder({
      ...body,
      serviceId: "verified_cleanup_pr" as A2aServiceId,
    });
    const status = result.ok ? 201 : 422;
    return NextResponse.json(result, { status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Order creation failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
