import { createHash } from "node:crypto";
import { resolveEntitlementMode } from "@/lib/entitlement/service";
import { checkOkxToolEntitlement } from "./entitlement";
import { createPaymentProvider } from "./payment-provider";
import { getA2mcpService } from "./services";
import type { CommerceBinding } from "./types";
import { claimIdempotencyLock } from "./store";
import { requireEntitlement } from "@/lib/payment/settlement";
import type { BoundQuote } from "@/lib/payment/types";
import { canonicalResourceUrl } from "@/lib/payment/canonical-app-url";
import { getBoundQuote } from "@/lib/payment/payment-store";
import {
  A2mcpX402Error,
  decodePaymentSignatureHeader,
  quoteIdFromPaymentPayload,
  verifyAndSettleA2mcpPayment,
} from "@/lib/payment/a2mcp-x402-production";

export class PaymentRequiredError extends Error {
  readonly status = 402;
  readonly body: unknown;
  readonly quoteId?: string;

  constructor(body: unknown, quoteId?: string) {
    super("Payment required");
    this.body = body;
    this.quoteId = quoteId;
  }
}

export class EntitlementDeniedError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 402) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function bindingRequestHash(binding: CommerceBinding): string {
  const canonical = JSON.stringify({
    operation: binding.operation,
    repository: binding.repository,
    branch: binding.branch,
    commitSha: binding.commitSha,
    findingIds: [...binding.findingIds].sort(),
    resourceUrl: binding.resourceUrl ?? "",
    requestMethod: binding.requestMethod ?? "",
    requestPayloadHash: binding.requestPayloadHash ?? "",
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function buildCommerceBinding(input: {
  operation: CommerceBinding["operation"];
  repository: string;
  branch: string;
  commitSha: string;
  findingIds?: string[];
  resourceUrl?: string;
  requestMethod?: string;
  requestPayloadHash?: string;
}): CommerceBinding {
  const binding: CommerceBinding = {
    operation: input.operation,
    repository: input.repository,
    branch: input.branch,
    commitSha: input.commitSha,
    findingIds: input.findingIds ?? [],
    resourceUrl: input.resourceUrl,
    requestMethod: input.requestMethod,
    requestPayloadHash: input.requestPayloadHash,
    requestHash: "",
  };
  binding.requestHash = bindingRequestHash(binding);
  return binding;
}

export interface CommerceGateResult {
  allowed: true;
  quote?: BoundQuote;
  mode: string;
  requestHash: string;
  paymentResponseHeader?: string;
  paymentReference?: string;
}

export async function gateA2mcpCall(input: {
  request: Request;
  serviceId: string;
  body: Record<string, unknown>;
  taskId: string;
  binding: CommerceBinding;
}): Promise<CommerceGateResult> {
  const service = getA2mcpService(input.serviceId);
  if (!service) {
    throw new EntitlementDeniedError("UNKNOWN_SERVICE", `Unknown service: ${input.serviceId}`, 400);
  }

  const paymentSignatureHeader =
    input.request.headers.get("payment-signature") ??
    input.request.headers.get("x-payment-signature");
  let paymentPayload: ReturnType<typeof decodePaymentSignatureHeader> | undefined;
  if (paymentSignatureHeader) {
    try {
      paymentPayload = decodePaymentSignatureHeader(paymentSignatureHeader);
    } catch (error) {
      const message = error instanceof A2mcpX402Error ? error.message : "Invalid payment signature.";
      throw new EntitlementDeniedError("INVALID_PAYMENT", message, 402);
    }
  }

  const quoteId =
    (typeof input.body.quoteId === "string" ? input.body.quoteId : undefined) ??
    input.request.headers.get("x-repodiet-quote-id") ??
    (paymentPayload ? quoteIdFromPaymentPayload(paymentPayload) : undefined) ??
    undefined;

  const entitlementCheck = checkOkxToolEntitlement({
    toolKey: input.serviceId,
    request: input.request,
    quoteId,
  });

  if (entitlementCheck.allowed && entitlementCheck.mode === "free_beta") {
    return { allowed: true, mode: "free_beta", requestHash: input.binding.requestHash };
  }

  const idempotencyKey =
    (typeof input.body.idempotencyKey === "string" ? input.body.idempotencyKey : undefined) ??
    input.request.headers.get("idempotency-key") ??
    undefined;

  if (idempotencyKey) {
    const lock = await claimIdempotencyLock(
      input.serviceId,
      input.binding.requestHash,
      idempotencyKey,
      input.taskId
    );
    if (!lock.claimed && lock.existingTaskId) {
      throw new EntitlementDeniedError(
        "DUPLICATE_REQUEST",
        `Duplicate request for this idempotency key — original task: ${lock.existingTaskId}. Authorization and payment state are not implied.`,
        409
      );
    }
  }

  if (!quoteId) {
    const provider = createPaymentProvider();
    const requestPath = new URL(input.request.url).pathname;
    const requirement = await provider.createRequirement({
      serviceId: input.serviceId as import("./types").A2mcpServiceId,
      repository: input.binding.repository,
      branch: input.binding.branch,
      commitSha: input.binding.commitSha,
      requestHash: input.binding.requestHash,
      resourceUrl: canonicalResourceUrl(requestPath, input.request.url),
      requestMethod: input.binding.requestMethod ?? input.request.method.toUpperCase(),
      requestPayloadHash: input.binding.requestPayloadHash ?? "",
      findingIds: input.binding.findingIds,
      idempotencyKey,
    });
    throw new PaymentRequiredError(requirement.x402Body, requirement.quoteId);
  }

  let paymentResponseHeader: string | undefined;
  let paymentReference: string | undefined;
  if (paymentPayload) {
    const quote = await getBoundQuote(quoteId);
    if (!quote) {
      throw new EntitlementDeniedError("INVALID_PAYMENT", "Payment quote was not found.", 402);
    }
    if (quote.paymentStatus !== "verified") {
      try {
        const settlement = await verifyAndSettleA2mcpPayment({
          payload: paymentPayload,
          quote,
          binding: input.binding,
        });
        paymentResponseHeader = settlement.paymentResponseHeader;
        paymentReference = settlement.transaction;
      } catch (error) {
        if (error instanceof A2mcpX402Error) {
          throw new EntitlementDeniedError(error.code, error.message, error.retryable ? 503 : 402);
        }
        throw new EntitlementDeniedError("INVALID_PAYMENT", "Payment verification failed.", 402);
      }
    } else {
      paymentResponseHeader = quote.settlementResponseHeader;
      paymentReference = quote.paymentReference;
    }
  }

  const entitlement = await requireEntitlement({
    quoteId,
    taskId: input.taskId,
    repository: input.binding.repository,
    branch: input.binding.branch,
    commitSha: input.binding.commitSha,
    findingIds: input.binding.findingIds,
    operation: service.operation,
    requestHash: input.binding.requestHash,
    resourceUrl: input.binding.resourceUrl,
    requestMethod: input.binding.requestMethod,
    requestPayloadHash: input.binding.requestPayloadHash,
  });

  if (!entitlement.ok) {
    if (entitlement.status === "payment_required" || entitlement.status === "invalid_payment") {
      const provider = createPaymentProvider();
      const requestPath = new URL(input.request.url).pathname;
      const requirement = await provider.createRequirement({
        serviceId: input.serviceId as import("./types").A2mcpServiceId,
        repository: input.binding.repository,
        branch: input.binding.branch,
        commitSha: input.binding.commitSha,
        requestHash: input.binding.requestHash,
        resourceUrl: canonicalResourceUrl(requestPath, input.request.url),
        requestMethod: input.binding.requestMethod ?? input.request.method.toUpperCase(),
        requestPayloadHash: input.binding.requestPayloadHash ?? "",
        findingIds: input.binding.findingIds,
        idempotencyKey,
      });
      throw new PaymentRequiredError(requirement.x402Body, requirement.quoteId);
    }
    throw new EntitlementDeniedError(
      entitlement.status,
      entitlement.reason ?? "Entitlement verification failed.",
      entitlement.status === "execution_started" ? 409 : 402
    );
  }

  return {
    allowed: true,
    quote: entitlement.quote,
    mode: resolveEntitlementMode(),
    requestHash: input.binding.requestHash,
    paymentResponseHeader: paymentResponseHeader ?? entitlement.quote?.settlementResponseHeader,
    paymentReference: paymentReference ?? entitlement.quote?.paymentReference,
  };
}

export function resultHash(payload: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}
