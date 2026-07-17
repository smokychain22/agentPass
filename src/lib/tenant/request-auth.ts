import {
  assertSameTenant,
  tenantIdFromBuyer,
  type TenantAccessDenial,
} from "@/lib/tenant/types";
import { customerError } from "@/lib/product/customer-errors";

export interface TenantRequestIdentity {
  tenantId: string;
  okxBuyerId?: string;
  buyerWallet?: string;
  source: "header" | "query" | "anonymous";
}

/**
 * Resolve tenant identity from request headers.
 * Authorization is explicit — resource ownership must still be checked.
 */
export function resolveTenantIdentity(request: Request): TenantRequestIdentity {
  const okxBuyerId =
    request.headers.get("x-repodiet-okx-buyer-id")?.trim() ||
    request.headers.get("x-okx-buyer-id")?.trim() ||
    undefined;
  const buyerWallet =
    request.headers.get("x-repodiet-buyer-wallet")?.trim() ||
    request.headers.get("x-buyer-wallet")?.trim() ||
    undefined;
  const explicitTenant = request.headers.get("x-repodiet-tenant-id")?.trim();

  if (explicitTenant || okxBuyerId || buyerWallet) {
    return {
      tenantId:
        explicitTenant ||
        tenantIdFromBuyer({ okxBuyerId, buyerWallet }),
      okxBuyerId,
      buyerWallet,
      source: "header",
    };
  }

  return {
    tenantId: "anonymous_public_readonly",
    source: "anonymous",
  };
}

export function denyUnlessTenantOwns(input: {
  resourceTenantId?: string;
  requestTenantId: string;
  /** When true, anonymous may read resources tagged anonymous_public_readonly. */
  allowAnonymousPublic?: boolean;
}): TenantAccessDenial | null {
  if (!input.resourceTenantId) {
    // Legacy records without tenant binding — deny in production once migrated.
    if (process.env.REPODIET_REQUIRE_TENANT_BINDING === "1") {
      return {
        code: "TENANT_REQUIRED",
        message: "Resource is not tenant-bound.",
        retryable: false,
        requiredAction: "PROVIDE_TENANT",
      };
    }
    return null;
  }

  if (
    input.allowAnonymousPublic &&
    input.resourceTenantId === "anonymous_public_readonly" &&
    input.requestTenantId === "anonymous_public_readonly"
  ) {
    return null;
  }

  return assertSameTenant(input.resourceTenantId, input.requestTenantId);
}

export function tenantDenialResponse(denial: TenantAccessDenial, status = 404) {
  // Use 404 by default to avoid leaking existence across tenants.
  const code = denial.code === "TENANT_MISMATCH" ? "TENANT_FORBIDDEN" : denial.code === "TENANT_REQUIRED" ? "TENANT_FORBIDDEN" : "TASK_NOT_FOUND";
  return {
    status: denial.code === "TENANT_REQUIRED" ? 401 : status,
    body: customerError({
      code: code as "TENANT_FORBIDDEN" | "TASK_NOT_FOUND",
      message: denial.message,
      retryable: false,
      requiredAction: denial.requiredAction,
    }),
  };
}
