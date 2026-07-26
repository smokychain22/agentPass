import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import {
  buildMarketplaceIntakeResponse,
  extractUserMessage,
  isMarketplaceDiscoveryMessage,
} from "@/lib/a2a/marketplace-intake";
import {
  logMarketplaceTelemetry,
  touchMarketplaceHealth,
} from "@/lib/okx/marketplace-telemetry";
import { requirePinnedService } from "@/lib/okx-runtime/service-selection";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(request: Request) {
  const requestId = `req_${nanoid(12)}`;
  const started = Date.now();

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      {
        code: "INVALID_INPUT",
        message: "Request body must be valid JSON.",
        retryable: false,
        paymentRequired: false,
        paymentAlreadySettled: false,
        requestId,
      },
      { status: 400 }
    );
  }

  const message = extractUserMessage(body) ?? "";
  const suppliedAgentId = String(body.aspAgentId ?? body.agentId ?? "9636");
  const suppliedServiceId =
    body.serviceId === undefined ? "37348" : String(body.serviceId);
  const suppliedServiceType =
    body.serviceType === undefined ? "A2A" : String(body.serviceType);
  try {
    requirePinnedService({
      protocol: "a2a",
      agentId: suppliedAgentId,
      serviceId: suppliedServiceId,
      serviceType: suppliedServiceType,
    });
  } catch (error) {
    return NextResponse.json(
      {
        code: "INCOMPATIBLE_SERVICE_BINDING",
        message: error instanceof Error ? error.message : "Invalid A2A service binding.",
        retryable: false,
        paymentRequired: false,
        paymentAlreadySettled: false,
        requestId,
      },
      { status: 422 }
    );
  }
  logMarketplaceTelemetry("a2a_message_received", {
    requestId,
    hasMessage: Boolean(message),
    aspAgentId: suppliedAgentId,
    serviceId: suppliedServiceId,
  });

  if (!message || !isMarketplaceDiscoveryMessage(message)) {
    return NextResponse.json(
      {
        code: "INTAKE_REQUIRED",
        message:
          "Send a marketplace service request (for example: I would like to use the services of agent ID 9636).",
        retryable: true,
        paymentRequired: false,
        paymentAlreadySettled: false,
        requestId,
      },
      { status: 400 }
    );
  }

  const response = buildMarketplaceIntakeResponse(requestId);
  logMarketplaceTelemetry("a2a_acknowledgement_sent", {
    requestId,
    durationMs: Date.now() - started,
    aspAgentId: response.aspAgentId,
  });
  await touchMarketplaceHealth({ a2aInitialResponseReady: true });

  return NextResponse.json({
    success: true,
    ...response,
    responseTimeMs: Date.now() - started,
  });
}
