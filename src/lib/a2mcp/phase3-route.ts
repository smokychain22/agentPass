import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { A2MCP_VERSION, QUICK_TRIAGE_TIMEOUT_MS, TOOL_TIMEOUT_MS } from "./constants";
import { ToolExecutionError, mapErrorToToolError } from "./errors";
import { withTimeout } from "./responses";
import { buildToolActionResponse, buildToolErrorResponse } from "./tool-contract";
import type { AgentTaskRecord } from "./task-store";
import { createTaskId, getAgentTask } from "./task-store";
import {
  EntitlementDeniedError,
  gateA2mcpCall,
  PaymentRequiredError,
} from "@/lib/okx/commerce-gateway";
import { resolveBindingFromBody } from "@/lib/okx/a2mcp-adapter";
import { getA2mcpService } from "@/lib/okx/services";
import { signOkxReceipt } from "@/lib/okx/payment-provider";
import type { CommerceOperation } from "@/lib/payment/types";
import { paymentRequiredJsonResponse } from "@/lib/payment/x402-payment-required";
import {
  getCompletedA2mcpExecution,
  getCompletedA2mcpExecutionByQuote,
  newCompletedExecution,
  saveCompletedA2mcpExecution,
} from "@/lib/a2mcp/a2mcp-execution-store";
import { markQuoteRetryableFailure, markQuoteCompleted } from "@/lib/payment/settlement";
import { getBoundQuote } from "@/lib/payment/payment-store";

export interface Phase3RouteOptions {
  paid?: boolean;
  operation?: CommerceOperation;
  timeoutMs?: number;
}

function resultDigest(payload: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

function resolveTimeoutMs(tool: string, options?: Phase3RouteOptions): number {
  if (options?.timeoutMs != null) return options.timeoutMs;
  if (tool === "analyze_repository") return QUICK_TRIAGE_TIMEOUT_MS;
  return TOOL_TIMEOUT_MS;
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
  const timeoutMs = resolveTimeoutMs(tool, options);

  let gateQuoteId: string | undefined;
  let requestHash: string | undefined;
  let executionRequestDigest: string | undefined;

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

    if (paid) {
      const binding = await resolveBindingFromBody(body, operation);
      executionRequestDigest = binding.requestHash;
      requestHash = executionRequestDigest;

      const quoteId =
        (typeof body.quoteId === "string" ? body.quoteId : undefined) ??
        request.headers.get("x-repodiet-quote-id") ??
        undefined;

      if (quoteId) {
        const quoteForCache = await getBoundQuote(quoteId);
        const digests = [executionRequestDigest, quoteForCache?.requestHash].filter(
          (value): value is string => Boolean(value)
        );
        for (const digest of digests) {
          const cached = await getCompletedA2mcpExecution(quoteId, digest);
          if (cached) {
            return NextResponse.json(
              {
                ...cached.responseBody,
                alreadyProcessed: true,
                idempotentReplay: true,
                originalTaskId: cached.taskId,
                receiptId: cached.receiptId,
              },
              { status: cached.httpStatus }
            );
          }
        }
        // Quote-level cache (covers digest-key drift between quote/execution layers).
        const byQuote = await getCompletedA2mcpExecutionByQuote(quoteId);
        if (byQuote) {
          return NextResponse.json(
            {
              ...byQuote.responseBody,
              alreadyProcessed: true,
              idempotentReplay: true,
              originalTaskId: byQuote.taskId,
              receiptId: byQuote.receiptId,
            },
            { status: byQuote.httpStatus }
          );
        }
      }

      const gate = await gateA2mcpCall({
        request,
        serviceId: tool,
        body,
        taskId,
        binding,
      });
      gateQuoteId = gate.quote?.quoteId ?? quoteId;
      executionRequestDigest = gate.requestHash ?? executionRequestDigest;
      // Prefer authorized quote commercial digest for receipt binding.
      requestHash = gate.quote?.requestHash ?? gate.requestHash;

      if (gateQuoteId) {
        const completedQuote = await getBoundQuote(gateQuoteId);
        if (
          completedQuote?.executionState === "SUCCEEDED" ||
          completedQuote?.lifecycleStatus === "completed"
        ) {
          if (requestHash) {
            const cached = await getCompletedA2mcpExecution(completedQuote.quoteId, requestHash);
            if (cached) {
              return NextResponse.json(
                {
                  ...cached.responseBody,
                  alreadyProcessed: true,
                  idempotentReplay: true,
                  originalTaskId: cached.taskId,
                  receiptId: cached.receiptId,
                },
                { status: cached.httpStatus }
              );
            }
          }
          if (completedQuote.completedTaskId) {
            const prior = await getAgentTask(completedQuote.completedTaskId);
            if (prior) {
              const response = buildToolActionResponse(tool, prior);
              Object.assign(response, {
                service: tool,
                alreadyProcessed: true,
                idempotentReplay: true,
              });
              return NextResponse.json(response, { status: 200 });
            }
          }
          // Never re-execute a SUCCEEDED quote — even if cache/task records are missing.
          return NextResponse.json(
            {
              ...buildToolErrorResponse(
                tool,
                taskId,
                "DUPLICATE_REQUEST",
                "Quote already completed successfully. Result cache unavailable for replay."
              ),
              recoverable: false,
              executionState: "SUCCEEDED",
              quoteId: completedQuote.quoteId,
              receiptId: completedQuote.completedReceiptId,
              alreadyProcessed: true,
            },
            { status: 409 }
          );
        }
      }
    }

    let task: AgentTaskRecord;
    try {
      task = await withTimeout(handler(body, taskId), timeoutMs, tool);
    } catch (err) {
      const mapped = mapErrorToToolError(err, tool);
      if (paid && gateQuoteId && (mapped.code === "SCAN_TIMEOUT" || mapped.status >= 500)) {
        await markQuoteRetryableFailure(gateQuoteId, taskId, mapped.message);
        return NextResponse.json(
          {
            ...buildToolErrorResponse(tool, taskId, mapped.code, mapped.message),
            recoverable: true,
            executionState: "FAILED_RETRYABLE",
            quoteId: gateQuoteId,
            requestHash,
            hint: "Funded entitlement preserved — retry the same quoteId without a new payment.",
          },
          { status: mapped.status }
        );
      }
      throw err;
    }

    if (paid && task.status === "completed") {
      const quote = gateQuoteId ? await getBoundQuote(gateQuoteId) : undefined;
      const quoteRequestDigest = quote?.requestHash ?? requestHash ?? "";
      const execDigest =
        executionRequestDigest && executionRequestDigest !== quoteRequestDigest
          ? executionRequestDigest
          : undefined;
      const receipt = await signOkxReceipt({
        serviceId: tool,
        serviceType: "A2MCP",
        taskId,
        requestHash: quoteRequestDigest,
        quoteRequestDigest,
        executionRequestDigest: execDigest,
        result: task.result,
        quoteId: gateQuoteId,
        paymentReference: quote?.paymentReference,
        buyer: quote?.payer,
        seller: quote?.recipient,
        amountMicro: quote?.amountMicro,
        token: quote?.asset,
        network: quote?.network,
        operation: quote?.operation,
        repository: quote?.repository,
      });
      task.receipt = {
        ...task.receipt,
        receiptId: receipt.receiptId,
        requestHash: receipt.requestHash,
        quoteRequestDigest: receipt.quoteRequestDigest,
        executionRequestDigest: receipt.executionRequestDigest,
        resultHash: receipt.resultHash,
        signature: receipt.signature,
        operatorAgentId: receipt.operatorAgentId,
        paymentReference: receipt.paymentReference,
        quoteId: receipt.quoteId,
      };

      if (gateQuoteId) {
        await markQuoteCompleted(gateQuoteId, taskId, receipt.receiptId);
        const responsePreview = buildToolActionResponse(tool, task);
        Object.assign(responsePreview, { service: tool });
        const completed = newCompletedExecution({
          quoteId: gateQuoteId,
          requestHash: quoteRequestDigest,
          taskId,
          receiptId: receipt.receiptId,
          httpStatus: 200,
          responseBody: responsePreview as unknown as Record<string, unknown>,
          resultDigest: resultDigest(task.result),
        });
        await saveCompletedA2mcpExecution(completed);
        // Also index under the execution-binding digest when it differs, for identical-request replay.
        if (execDigest) {
          await saveCompletedA2mcpExecution({
            ...completed,
            requestHash: execDigest,
          });
        }
      }
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
      return paymentRequiredJsonResponse(err.body, 402);
    }
    if (err instanceof EntitlementDeniedError) {
      if (err.code === "DUPLICATE_REQUEST" || /progress/i.test(err.message)) {
        return NextResponse.json(
          {
            ...buildToolErrorResponse(tool, taskId, err.code, err.message),
            recoverable: true,
            executionState: "EXECUTING",
          },
          { status: err.status === 409 ? 409 : 409 }
        );
      }
      return NextResponse.json(
        buildToolErrorResponse(tool, taskId, err.code, err.message),
        { status: err.status }
      );
    }
    const mapped = mapErrorToToolError(err, tool);
    if (paid && gateQuoteId && mapped.status >= 500) {
      await markQuoteRetryableFailure(gateQuoteId, taskId, mapped.message).catch(() => undefined);
    }
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
