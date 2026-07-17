import {
  assertSameTenant,
  tenantIdFromBuyer,
  type TenantAccessDenial,
} from "@/lib/tenant/types";
import { customerError } from "@/lib/product/customer-errors";
import { BROWSER_SESSION_COOKIE } from "@/lib/github-app/browser-session";

export interface TenantRequestIdentity {
  tenantId: string;
  okxBuyerId?: string;
  buyerWallet?: string;
  source: "session" | "buyer" | "anonymous";
}

function readCookie(request: Request, name: string): string | undefined {
  const raw = request.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("=").trim() || "");
  }
  return undefined;
}

/**
 * Resolve tenant identity for marketplace/web requests.
 * Free-form x-repodiet-tenant-id is NOT accepted as ownership proof.
 * Prefer authenticated browser session, then verified buyer headers.
 */
export function resolveTenantIdentity(request: Request): TenantRequestIdentity {
  const sessionId = readCookie(request, BROWSER_SESSION_COOKIE)?.trim();
  if (sessionId) {
    return {
      tenantId: `browser:${sessionId}`,
      source: "session",
    };
  }

  const okxBuyerId =
    request.headers.get("x-repodiet-okx-buyer-id")?.trim() ||
    request.headers.get("x-okx-buyer-id")?.trim() ||
    undefined;
  const buyerWallet =
    request.headers.get("x-repodiet-buyer-wallet")?.trim() ||
    request.headers.get("x-buyer-wallet")?.trim() ||
    undefined;

  if (okxBuyerId || buyerWallet) {
    return {
      tenantId: tenantIdFromBuyer({ okxBuyerId, buyerWallet }),
      okxBuyerId,
      buyerWallet,
      source: "buyer",
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
  allowAnonymousPublic?: boolean;
}): TenantAccessDenial | null {
  if (!input.resourceTenantId) {
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
  const code =
    denial.code === "TENANT_MISMATCH"
      ? "TENANT_FORBIDDEN"
      : denial.code === "TENANT_REQUIRED"
        ? "TENANT_FORBIDDEN"
        : "TASK_NOT_FOUND";
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
