import { NextResponse } from "next/server";
import { runPhase3ToolRoute } from "@/lib/a2mcp/phase3-route";
import { executeQuickTriage } from "@/lib/a2mcp/quick-triage-engine";
import { ToolExecutionError } from "@/lib/a2mcp/errors";
import { buildToolErrorResponse } from "@/lib/a2mcp/tool-contract";
import { createTaskId } from "@/lib/a2mcp/task-store";
import {
  executeGreenPrVerification,
  isGreenPrVerificationOperation,
} from "@/lib/a2mcp/green-pr-verification";
import { normalizeRepositoryTarget } from "@/lib/repository/repository-target";
import {
  mintOfficialPaymentChallenge,
  processOfficialPayment,
  settleOfficialPayment,
  OfficialX402ConfigError,
} from "@/lib/payment/okx-official-x402";

/**
 * Pulls a stable, non-secret reference out of the SDK's verified payment
 * payload for receipt binding. Never invents one: if the payload carries no
 * usable identifier the receipt simply has none, rather than a fabricated id.
 */
function extractOfficialPaymentReference(paymentPayload: unknown): string | undefined {
  if (!paymentPayload || typeof paymentPayload !== "object") return undefined;
  const record = paymentPayload as Record<string, unknown>;
  const direct = record.transactionHash ?? record.txHash ?? record.nonce;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const payload = record.payload as Record<string, unknown> | undefined;
  const nested = payload?.transactionHash ?? payload?.txHash ?? payload?.nonce;
  return typeof nested === "string" && nested.trim() ? nested.trim() : undefined;
}

type OfficialBoundaryResult =
  | { kind: "verified"; paymentPayload: unknown; paymentRequirements: unknown; declaredExtensions?: Record<string, unknown> }
  | { kind: "halted"; response: NextResponse };

/**
 * The single official-SDK payment boundary for this endpoint. Both operations
 * served here go through it, so the retired custom gate is unreachable in
 * production on this route.
 */
async function runOfficialPaymentBoundary(
  request: Request,
  body: Record<string, unknown>,
  taskId: string
): Promise<OfficialBoundaryResult> {
  let payment: Awaited<ReturnType<typeof processOfficialPayment>>;
  try {
    payment = await processOfficialPayment(request, body);
  } catch (error) {
    // The official SDK could not run (missing/invalid OKX Developer Portal
    // credentials, or the facilitator is unreachable). Two things must NOT
    // happen here: serving the analysis for free, and silently falling back to
    // the retired custom gate. Fail closed and say so plainly.
    return {
      kind: "halted",
      response: NextResponse.json(
        buildToolErrorResponse(
          "analyze_repository",
          taskId,
          "PAYMENT_BOUNDARY_UNAVAILABLE",
          error instanceof OfficialX402ConfigError
            ? error.message
            : "The official OKX payment boundary is temporarily unavailable."
        ),
        { status: 503 }
      ),
    };
  }

  if (payment.kind === "unpaid") {
    // The SDK's own PAYMENT-REQUIRED challenge, returned verbatim.
    return {
      kind: "halted",
      response: new NextResponse(
        payment.body === undefined ? null : JSON.stringify(payment.body),
        { status: payment.status, headers: payment.headers }
      ),
    };
  }

  return {
    kind: "verified",
    paymentPayload: payment.paymentPayload,
    paymentRequirements: payment.paymentRequirements,
    declaredExtensions: payment.declaredExtensions,
  };
}

/**
 * Settles through the official SDK only after the service actually succeeded,
 * so a failed execution never settles a payment, and attaches the settlement
 * headers (including PAYMENT-RESPONSE) to the successful response.
 */
async function attachOfficialSettlement(
  executed: NextResponse,
  payment: Extract<OfficialBoundaryResult, { kind: "verified" }>
): Promise<NextResponse> {
  if (executed.status < 200 || executed.status >= 300) return executed;
  try {
    const settled = await settleOfficialPayment(
      payment.paymentPayload,
      payment.paymentRequirements,
      payment.declaredExtensions
    );
    for (const [key, value] of Object.entries(settled.headers ?? {})) {
      executed.headers.set(key, value);
    }
    if (!settled.success) {
      // Surface the real settlement failure rather than implying success.
      executed.headers.set("x-repodiet-settlement-error", settled.errorReason ?? "unknown");
    }
  } catch (error) {
    executed.headers.set(
      "x-repodiet-settlement-error",
      error instanceof Error ? error.name : "settlement_failed"
    );
  }
  return executed;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Discovery probe for the registered A2MCP endpoint.
 *
 * === Why this returns 402 and not 200 ===
 *
 * This route used to answer GET/HEAD with a 200 "liveness descriptor", added
 * as speculative hardening whose own comment conceded there was "no evidence
 * that any reviewer probe required GET or HEAD". That turned out to be
 * actively harmful. `onchainos agent x402-check --endpoint <url>` — OKX's own
 * endpoint validator, and the obvious tool for a reviewer to run — probes with
 * GET when no `--body` is supplied, and against live production on 2026-08-07
 * it returned:
 *
 *   {"reason":"Endpoint returned HTTP 200 (not 402); not a valid x402
 *     service.","statusCode":200,"valid":false}
 *
 * The very same command WITH `--body` returned `valid:true`, `amountHuman:0.03`,
 * `network:eip155:196`, `payTo:0xaa89…f1a`. So the paid path was correct all
 * along and only the unauthenticated probe misrepresented the service — the
 * 200 was reporting "online" while telling OKX's validator this was not an
 * x402 endpoint at all.
 *
 * A 402 carrying the SDK's own PAYMENT-REQUIRED challenge is both the
 * standards-correct answer for a protected resource and a strictly better
 * liveness signal: it proves the route is reachable AND that its payment
 * boundary is live, which a static descriptor never did.
 *
 * Still no billable work: no repository is fetched, no scan runs, nothing is
 * verified, recorded or settled. The challenge is minted by the official SDK
 * from the same RouteConfig the POST path uses, so discovery and payment can
 * never quote different terms.
 */
async function buildProbeResponse(request: Request, includeBody: boolean): Promise<NextResponse> {
  let challenge: Awaited<ReturnType<typeof mintOfficialPaymentChallenge>>;
  try {
    challenge = await mintOfficialPaymentChallenge(request);
  } catch (error) {
    // Fails closed exactly like POST: a probe must never claim the service is
    // healthy while its payment boundary is not.
    return NextResponse.json(
      buildToolErrorResponse(
        "analyze_repository",
        createTaskId(),
        "PAYMENT_BOUNDARY_UNAVAILABLE",
        error instanceof OfficialX402ConfigError
          ? error.message
          : "The official OKX payment boundary is temporarily unavailable."
      ),
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const headers = new Headers(challenge.headers);
  headers.set("Cache-Control", "no-store");
  return new NextResponse(
    includeBody ? (challenge.body === undefined ? null : JSON.stringify(challenge.body)) : null,
    { status: challenge.status, headers }
  );
}

/** Discovery probe — fast, never billable, and honest about the price. */
export async function GET(request: Request) {
  return buildProbeResponse(request, true);
}

/** Discovery probe (no body) — identical status and headers to GET. */
export async function HEAD(request: Request) {
  return buildProbeResponse(request, false);
}

function isValidPublicGitHubRepository(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname !== "github.com") return false;
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts.length >= 2;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const taskId = createTaskId();

  let body: Record<string, unknown>;
  let rawBody: string;
  try {
    rawBody = await request.text();
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      buildToolErrorResponse(
        "analyze_repository",
        taskId,
        "INVALID_INPUT",
        "Request body must be valid JSON."
      ),
      { status: 400 }
    );
  }

  const repositoryUrl =
    typeof body.repositoryUrl === "string" ? body.repositoryUrl.trim() : "";
  const requestedOperation = body.operation;

  if (isGreenPrVerificationOperation(requestedOperation)) {
    // This operation shares the registered endpoint and the same 0.03 USDT
    // rail, so it must go through the official SDK too — otherwise the retired
    // custom gate would still be reachable in production on this route.
    const greenPrPayment = await runOfficialPaymentBoundary(request, body, taskId);
    if (greenPrPayment.kind !== "verified") return greenPrPayment.response;

    const forwardedRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: rawBody,
    });
    const greenPrResult = await runPhase3ToolRoute(
      "analyze_repository",
      forwardedRequest,
      executeGreenPrVerification,
      {
        officialSdkVerifiedPayment: {
          paymentReference: extractOfficialPaymentReference(greenPrPayment.paymentPayload),
        },
      }
    );
    return attachOfficialSettlement(greenPrResult, greenPrPayment);
  }
  const branch = typeof body.branch === "string" ? body.branch.trim() : undefined;
  const maximumFindingsRaw = body.maximumFindings;
  const maximumFindings =
    maximumFindingsRaw === undefined ? 10 : Number(maximumFindingsRaw);

  if (!repositoryUrl) {
    return NextResponse.json(
      buildToolErrorResponse(
        "analyze_repository",
        taskId,
        "INVALID_INPUT",
        "repositoryUrl is required."
      ),
      { status: 400 }
    );
  }

  if (!isValidPublicGitHubRepository(repositoryUrl)) {
    return NextResponse.json(
      buildToolErrorResponse(
        "analyze_repository",
        taskId,
        "UNSUPPORTED_REPOSITORY",
        "Only public https://github.com/owner/repo repositories are supported."
      ),
      { status: 422 }
    );
  }

  if (!Number.isFinite(maximumFindings) || maximumFindings < 1 || maximumFindings > 10) {
    return NextResponse.json(
      buildToolErrorResponse(
        "analyze_repository",
        taskId,
        "INVALID_INPUT",
        "maximumFindings must be a number between 1 and 10."
      ),
      { status: 400 }
    );
  }

  // ---- Official OKX Payment Seller SDK boundary -------------------------
  // OKX rejected listing 9636 on 2026-08-02 because this service did not use
  // the official SDK. From here the SDK is the only thing that mints the 402
  // and the only thing that verifies payment; the hand-rolled gate is bypassed
  // (see Phase3RouteOptions.officialSdkVerifiedPayment).
  const payment = await runOfficialPaymentBoundary(request, body, taskId);
  if (payment.kind !== "verified") return payment.response;

  const forwardedRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: rawBody,
  });

  const executed = await runPhase3ToolRoute(
    "analyze_repository",
    forwardedRequest,
    async (paidBody, paidTaskId) => {
      const paidRecord = paidBody as Record<string, unknown>;
      let repositoryTarget: Awaited<ReturnType<typeof normalizeRepositoryTarget>>;
      try {
        repositoryTarget = await normalizeRepositoryTarget({
          repositoryUrl,
          branch,
          resolveRemote: true,
        });
      } catch {
        throw new ToolExecutionError(
          "REPO_NOT_FOUND",
          "The public GitHub repository or requested branch could not be resolved to a commit.",
          422
        );
      }

      return executeQuickTriage(
        {
          ...paidRecord,
          repoUrl: repositoryUrl,
          repositoryUrl,
          branch: repositoryTarget.branch,
          commitSha: repositoryTarget.sourceCommit,
          maximumFindings: Math.floor(maximumFindings),
          source: "quick_triage",
          operation: "analyze_repository",
        },
        paidTaskId
      );
    },
    {
      timeoutMs: undefined, // use QUICK_TRIAGE_TIMEOUT_MS via tool name
      officialSdkVerifiedPayment: {
        paymentReference: extractOfficialPaymentReference(payment.paymentPayload),
      },
    }
  );

  return attachOfficialSettlement(executed, payment);
}

