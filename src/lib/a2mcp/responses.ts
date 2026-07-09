import { NextResponse } from "next/server";
import { A2MCP_VERSION } from "./constants";
import type { ErrorCode } from "./schemas";
import { ToolExecutionError, mapErrorToToolError } from "./errors";
import { TOOL_TIMEOUT_MS } from "./constants";

export interface ToolErrorBody {
  ok: false;
  tool: string;
  version: string;
  error: {
    code: ErrorCode;
    message: string;
  };
}

export interface ToolSuccessBody<T extends Record<string, unknown>> {
  ok: true;
  tool: string;
  version: string;
  warnings: string[];
  [key: string]: unknown;
}

export function toolErrorResponse(tool: string, code: ErrorCode, message: string, status: number) {
  const body: ToolErrorBody = {
    ok: false,
    tool,
    version: A2MCP_VERSION,
    error: { code, message },
  };
  return NextResponse.json(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function toolSuccessResponse<T extends Record<string, unknown>>(
  tool: string,
  payload: T,
  warnings: string[] = []
) {
  const body: ToolSuccessBody<T> = {
    ok: true,
    tool,
    version: A2MCP_VERSION,
    warnings,
    ...payload,
  };
  return NextResponse.json(body, {
    headers: { "Content-Type": "application/json" },
  });
}

export function withTimeout<T>(promise: Promise<T>, ms: number, tool: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new ToolExecutionError(
          "SCAN_TIMEOUT",
          `Tool "${tool}" timed out after ${Math.round(ms / 1000)} seconds.`,
          504
        )
      );
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function runToolRoute<T extends Record<string, unknown>>(
  tool: string,
  request: Request,
  handler: (body: unknown) => Promise<{ data: T; warnings?: string[] }>
): Promise<NextResponse> {
  try {
    if (request.method !== "POST") {
      return toolErrorResponse(tool, "INVALID_INPUT", "Only POST is supported.", 405);
    }

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      throw new ToolExecutionError("INVALID_INPUT", "Request body must be valid JSON.", 400);
    }

    const { data, warnings = [] } = await withTimeout(handler(body), TOOL_TIMEOUT_MS, tool);
    return toolSuccessResponse(tool, data, warnings);
  } catch (err) {
    const mapped = mapErrorToToolError(err, tool);
    return toolErrorResponse(tool, mapped.code, mapped.message, mapped.status);
  }
}
