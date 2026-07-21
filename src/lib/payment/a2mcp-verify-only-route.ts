import { NextResponse } from "next/server";
import {
  runVerifyOnlyDiagnostic,
  VerifyOnlyDiagnosticError,
  type VerifyOnlyDiagnosticRequest,
  type VerifyOnlyDiagnosticResponse,
} from "./a2mcp-verify-only-diagnostic";
import {
  DiagnosticRequestError,
  readLimitedJsonBody,
  validDiagnosticToken,
  verifyDiagnosticEnabled,
} from "./a2mcp-verify-only-route-security";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" } as const;

type DiagnosticRunner = (input: {
  request: VerifyOnlyDiagnosticRequest;
}) => Promise<VerifyOnlyDiagnosticResponse>;

function response(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

export function createVerifyOnlyDiagnosticRoute(input: {
  env?: NodeJS.ProcessEnv;
  run?: DiagnosticRunner;
} = {}) {
  return async function POST(request: Request): Promise<NextResponse> {
    const env = input.env ?? process.env;
    if (!verifyDiagnosticEnabled(env)) {
      return response({ ok: false, error: "Not found." }, 404);
    }
    if (!validDiagnosticToken(request.headers.get("x-repodiet-diagnostic-token"), env)) {
      return response({ ok: false, error: "Unauthorized." }, 401);
    }

    try {
      const body = await readLimitedJsonBody(request);
      const paymentSignature = request.headers.get("payment-signature") ?? "";
      if (!paymentSignature) {
        return response({ ok: false, error: "Payment authorization is required." }, 400);
      }
      const diagnosticRequest: VerifyOnlyDiagnosticRequest = {
        attemptId: typeof body.attemptId === "string" ? body.attemptId : "",
        attemptCreatedAt: typeof body.attemptCreatedAt === "string" ? body.attemptCreatedAt : "",
        paymentSignature,
        originalRequest:
          body.originalRequest && typeof body.originalRequest === "object" && !Array.isArray(body.originalRequest)
            ? body.originalRequest as Record<string, unknown>
            : {},
        originalResourceUrl:
          typeof body.originalResourceUrl === "string" ? body.originalResourceUrl.trim() : "",
        paymentRequirements:
          body.paymentRequirements && typeof body.paymentRequirements === "object" && !Array.isArray(body.paymentRequirements)
            ? body.paymentRequirements as Record<string, unknown>
            : {},
      };
      return response(await (input.run ?? runVerifyOnlyDiagnostic)({ request: diagnosticRequest }), 200);
    } catch (error) {
      if (error instanceof DiagnosticRequestError) {
        return response({ ok: false, error: error.message, code: error.code }, error.status);
      }
      if (error instanceof VerifyOnlyDiagnosticError) {
        return response({
          ok: false,
          correlationId: error.correlationId,
          attemptId: error.attemptId,
          error: error.message,
          code: error.code,
          settlementAttempted: false,
          findingsReleased: false,
          receiptCreated: false,
        }, error.status);
      }
      return response({
        ok: false,
        error: "Diagnostic verification failed.",
        settlementAttempted: false,
        findingsReleased: false,
        receiptCreated: false,
      }, 500);
    }
  };
}
