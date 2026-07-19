import { NextResponse } from "next/server";
import { buildOkxHealthResponse } from "@/lib/okx/health";
import { getAgentRuntimeHealth } from "@/lib/a2a/agent-runtime-health";
import { getMarketplaceHealthSnapshot } from "@/lib/okx/marketplace-telemetry";
import { OKX_MARKETPLACE_LIFECYCLE_STATES } from "@/lib/a2a/okx-marketplace-lifecycle";

export const runtime = "nodejs";

/**
 * Agent availability monitoring for OKX marketplace reviewers.
 * Alerts when the registered Agent cannot answer tasks.
 */
export async function GET() {
  const [agent, marketplace, okx] = await Promise.all([
    getAgentRuntimeHealth(),
    getMarketplaceHealthSnapshot(),
    buildOkxHealthResponse(),
  ]);

  return NextResponse.json({
    ok: !agent.alertAgentCannotAnswer,
    service: "RepoDiet OKX Agent Runtime",
    agent,
    marketplace: {
      a2aRuntimeReady: marketplace.a2aRuntimeReady,
      a2aInitialResponseReady: marketplace.a2aInitialResponseReady,
      a2mcpQuickTriageReady: marketplace.a2mcpQuickTriageReady,
      queueDepth: marketplace.queueDepth,
      workerReady: marketplace.workerReady,
      deliveryWorkerHealthy: agent.deliveryWorkerHealthy,
    },
    lifecycleStates: OKX_MARKETPLACE_LIFECYCLE_STATES,
    silentTimeoutPossible: false,
    immediateAcknowledgment: true,
    durableTaskRecovery: true,
    alert: agent.alertAgentCannotAnswer
      ? {
          severity: "critical",
          code: "AGENT_CANNOT_ANSWER",
          message: "RepoDiet Agent cannot answer OKX tasks — check runtime auth, queue, and last acknowledgement.",
        }
      : null,
    okxHealthTimestamp: okx.timestamp,
    timestamp: new Date().toISOString(),
  });
}
