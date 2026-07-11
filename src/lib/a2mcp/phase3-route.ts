import { NextResponse } from "next/server";
import { A2MCP_VERSION, TOOL_TIMEOUT_MS } from "./constants";
import { ToolExecutionError, mapErrorToToolError } from "./errors";
import { withTimeout } from "./responses";
import { buildToolActionResponse, buildToolErrorResponse } from "./tool-contract";
import type { AgentTaskRecord } from "./task-store";
import { createTaskId } from "./task-store";
import {
  EntitlementDeniedError,
  gateA2mcpCall,
  PaymentRequiredError,
} from "@/lib/okx/commerce-gateway";
import { resolveBindingFromBody } from "@/lib/okx/a2mcp-adapter";
import { getA2mcpService } from "@/lib/okx/services";
import { signOkxReceipt } from "@/lib/okx/payment-provider";
import type { CommerceOperation } from "@/lib/payment/types";

export interface Phase3RouteOptions {
  paid?: boolean;
  operation?: CommerceOperation;
  timeoutMs?: number;
}

export async function runPhase3ToolRoute(
  tool: string,
  request: Request,
  handler: (body: unknown, taskId: string) => Promise<AgentTaskRecord>,
  options?: Phase3RouteOptions
): Promise<NextResponse> {
  const taskId = createTaskId();
  const paid = options?.paid ?? Boolean(getA2mcpService(tool));
  const operation = options?.operation ?? (tool as CommerceOperation);

  try {
    if (request.method !== "POST") {
      return NextResponse.json(
        buildToolErrorResponse(tool, taskId, "INVALID_INPUT", "Only POST is supported."),
        { status: 405 }
      );
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new ToolExecutionError("INVALID_INPUT", "Request body must be valid JSON.", 400);
    }

    let gateQuoteId: string | undefined;
    let requestHash: string | undefined;

    if (paid) {
      const binding = await resolveBindingFromBody(body, operation);
      const gate = await gateA2mcpCall({
        request,
        serviceId: tool,
        body,
        taskId,
        binding,
      });
      gateQuoteId = gate.quote?.quoteId;
      requestHash = gate.requestHash;
    }

    const task = await withTimeout(handler(body, taskId), options?.timeoutMs ?? TOOL_TIMEOUT_MS, tool);

    if (paid && task.status === "completed") {
      const receipt = await signOkxReceipt({
        serviceId: tool,
        serviceType: "A2MCP",
        taskId,
        requestHash: requestHash ?? "",
        result: task.result,
        quoteId: gateQuoteId,
      });
      task.receipt = {
        ...task.receipt,
        receiptId: receipt.receiptId,
        requestHash: receipt.requestHash,
        resultHash: receipt.resultHash,
        signature: receipt.signature,
        operatorAgentId: receipt.operatorAgentId,
      };
    }

    const response = buildToolActionResponse(tool, task);
    if (paid) {
      Object.assign(response, { service: tool });
    }
    return NextResponse.json(response, {
      status: task.status === "failed" ? 422 : 200,
    });
  } catch (err) {
    if (err instanceof PaymentRequiredError) {
      return NextResponse.json(err.body, { status: 402 });
    }
    if (err instanceof EntitlementDeniedError) {
      return NextResponse.json(
        buildToolErrorResponse(tool, taskId, err.code, err.message),
        { status: err.status }
      );
    }
    const mapped = mapErrorToToolError(err, tool);
    return NextResponse.json(
      buildToolErrorResponse(tool, taskId, mapped.code, mapped.message),
      { status: mapped.status }
    );
  }
}

export function phase3GetResponse(tool: string, task: AgentTaskRecord): NextResponse {
  const response = buildToolActionResponse(tool, task);
  return NextResponse.json(response, {
    status: task.status === "failed" ? 404 : 200,
  });
}

export function phase3Meta() {
  return { tool: "get_task_status", version: A2MCP_VERSION };
}
