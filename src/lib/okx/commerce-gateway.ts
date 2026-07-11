import { createHash } from "node:crypto";
import { resolveEntitlementMode } from "@/lib/entitlement/service";
import { checkOkxToolEntitlement } from "./entitlement";
import { createPaymentProvider } from "./payment-provider";
import { getA2mcpService } from "./services";
import type { CommerceBinding } from "./types";
import { claimIdempotencyLock } from "./store";
import { requireEntitlement } from "@/lib/payment/settlement";
import type { BoundQuote } from "@/lib/payment/types";

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
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function buildCommerceBinding(input: {
  operation: CommerceBinding["operation"];
  repository: string;
  branch: string;
  commitSha: string;
  findingIds?: string[];
}): CommerceBinding {
  const binding: CommerceBinding = {
    operation: input.operation,
    repository: input.repository,
    branch: input.branch,
    commitSha: input.commitSha,
    findingIds: input.findingIds ?? [],
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

  const quoteId =
    (typeof input.body.quoteId === "string" ? input.body.quoteId : undefined) ??
    input.request.headers.get("x-repodiet-quote-id") ??
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
        `Duplicate paid request — original task: ${lock.existingTaskId}`,
        409
      );
    }
  }

  if (!quoteId) {
    const provider = createPaymentProvider();
    const requirement = await provider.createRequirement({
      serviceId: input.serviceId as import("./types").A2mcpServiceId,
      repository: input.binding.repository,
      branch: input.binding.branch,
      commitSha: input.binding.commitSha,
      requestHash: input.binding.requestHash,
      resourceUrl: new URL(input.request.url).toString(),
      findingIds: input.binding.findingIds,
      idempotencyKey,
    });
    throw new PaymentRequiredError(requirement.x402Body, requirement.quoteId);
  }

  const entitlement = await requireEntitlement({
    quoteId,
    taskId: input.taskId,
    repository: input.binding.repository,
    branch: input.binding.branch,
    commitSha: input.binding.commitSha,
    findingIds: input.binding.findingIds,
    operation: service.operation,
  });

  if (!entitlement.ok) {
    if (entitlement.status === "payment_required" || entitlement.status === "invalid_payment") {
      const provider = createPaymentProvider();
      const requirement = await provider.createRequirement({
        serviceId: input.serviceId as import("./types").A2mcpServiceId,
        repository: input.binding.repository,
        branch: input.binding.branch,
        commitSha: input.binding.commitSha,
        requestHash: input.binding.requestHash,
        resourceUrl: new URL(input.request.url).toString(),
        findingIds: input.binding.findingIds,
        idempotencyKey,
      });
      throw new PaymentRequiredError(requirement.x402Body, requirement.quoteId);
    }
    throw new EntitlementDeniedError(
      entitlement.status,
      entitlement.reason ?? "Entitlement verification failed."
    );
  }

  return {
    allowed: true,
    quote: entitlement.quote,
    mode: resolveEntitlementMode(),
    requestHash: input.binding.requestHash,
  };
}

export function resultHash(payload: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}
