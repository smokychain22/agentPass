import { timingSafeEqual } from "node:crypto";

export const VERIFY_DIAGNOSTIC_MAX_BODY_BYTES = 32 * 1024;

export function verifyDiagnosticEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.REPODIET_A2MCP_DIAGNOSTIC_ENABLED === "1" &&
    (env.REPODIET_A2MCP_DIAGNOSTIC_TOKEN?.trim().length ?? 0) >= 32;
}

export function validDiagnosticToken(
  provided: string | null,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const expected = env.REPODIET_A2MCP_DIAGNOSTIC_TOKEN?.trim() ?? "";
  const candidate = provided?.trim() ?? "";
  if (expected.length < 32 || candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate, "utf8"), Buffer.from(expected, "utf8"));
}

export class DiagnosticRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "DiagnosticRequestError";
  }
}

export async function readLimitedJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new DiagnosticRequestError("INVALID_CONTENT_TYPE", "Content-Type must be application/json.", 415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > VERIFY_DIAGNOSTIC_MAX_BODY_BYTES) {
    throw new DiagnosticRequestError("REQUEST_TOO_LARGE", "Request body is too large.", 413);
  }
  if (!request.body) {
    throw new DiagnosticRequestError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > VERIFY_DIAGNOSTIC_MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new DiagnosticRequestError("REQUEST_TOO_LARGE", "Request body is too large.", 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) {
    throw new DiagnosticRequestError("INVALID_JSON", "UTF-8 BOM is not accepted.", 400);
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new DiagnosticRequestError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
}
