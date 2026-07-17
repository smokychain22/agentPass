/**
 * Multi-tenant binding for every production marketplace record.
 * Customer A must never read or mutate Customer B's data by swapping IDs.
 */

export interface TenantBinding {
  tenantId: string;
  okxBuyerId?: string;
  buyerWallet?: string;
  githubInstallationId?: string;
  githubRepositoryId?: number | string;
  repositoryOwner: string;
  repositoryName: string;
  repository: string;
  branch: string;
  sourceCommit?: string;
  projectRoot: string;
  taskId?: string;
  scanId?: string;
  contractDigest?: string;
  paymentReference?: string;
  quoteId?: string;
}

export type TenantScopedResource =
  | "scan"
  | "findings"
  | "graph"
  | "deep_scan_job"
  | "task"
  | "quote"
  | "payment"
  | "contract"
  | "pull_request"
  | "receipt"
  | "attestation"
  | "proof";

export interface TenantAccessDenial {
  code: "TENANT_MISMATCH" | "TENANT_REQUIRED" | "RESOURCE_NOT_FOUND" | "FORBIDDEN";
  message: string;
  retryable: false;
  requiredAction: "AUTHENTICATE" | "USE_OWN_RESOURCE" | "PROVIDE_TENANT";
}

export function repositoryFullName(owner: string, name: string): string {
  return `${owner}/${name}`.toLowerCase();
}

export function normalizeWallet(wallet?: string | null): string | undefined {
  if (!wallet?.trim()) return undefined;
  return wallet.trim().toLowerCase();
}

/** Deterministic tenant id from buyer wallet when OKX buyer id is absent. */
export function tenantIdFromBuyer(input: {
  okxBuyerId?: string;
  buyerWallet?: string;
  installationId?: string;
}): string {
  if (input.okxBuyerId?.trim()) return `okx_${input.okxBuyerId.trim()}`;
  if (input.buyerWallet?.trim()) return `wallet_${normalizeWallet(input.buyerWallet)}`;
  if (input.installationId?.trim()) return `gh_install_${input.installationId.trim()}`;
  return "anonymous_public_readonly";
}

export function buildTenantBinding(input: {
  okxBuyerId?: string;
  buyerWallet?: string;
  githubInstallationId?: string;
  githubRepositoryId?: number | string;
  repositoryOwner: string;
  repositoryName: string;
  branch?: string;
  sourceCommit?: string;
  projectRoot?: string;
  taskId?: string;
  scanId?: string;
  contractDigest?: string;
  paymentReference?: string;
  quoteId?: string;
}): TenantBinding {
  const owner = input.repositoryOwner.trim();
  const name = input.repositoryName.trim();
  return {
    tenantId: tenantIdFromBuyer({
      okxBuyerId: input.okxBuyerId,
      buyerWallet: input.buyerWallet,
      installationId: input.githubInstallationId,
    }),
    okxBuyerId: input.okxBuyerId?.trim() || undefined,
    buyerWallet: normalizeWallet(input.buyerWallet),
    githubInstallationId: input.githubInstallationId?.trim() || undefined,
    githubRepositoryId: input.githubRepositoryId,
    repositoryOwner: owner,
    repositoryName: name,
    repository: repositoryFullName(owner, name),
    branch: input.branch?.trim() || "main",
    sourceCommit: input.sourceCommit?.trim() || undefined,
    projectRoot: input.projectRoot?.trim() || ".",
    taskId: input.taskId,
    scanId: input.scanId,
    contractDigest: input.contractDigest,
    paymentReference: input.paymentReference,
    quoteId: input.quoteId,
  };
}

export function assertSameTenant(
  resourceTenantId: string | undefined,
  requestTenantId: string | undefined
): TenantAccessDenial | null {
  if (!requestTenantId) {
    return {
      code: "TENANT_REQUIRED",
      message: "Tenant identity is required to access this resource.",
      retryable: false,
      requiredAction: "PROVIDE_TENANT",
    };
  }
  if (!resourceTenantId) {
    return {
      code: "RESOURCE_NOT_FOUND",
      message: "Resource not found.",
      retryable: false,
      requiredAction: "USE_OWN_RESOURCE",
    };
  }
  if (resourceTenantId !== requestTenantId) {
    // Identical message to not-found — do not leak existence of other tenants' IDs.
    return {
      code: "RESOURCE_NOT_FOUND",
      message: "Resource not found.",
      retryable: false,
      requiredAction: "USE_OWN_RESOURCE",
    };
  }
  return null;
}

export function assertTenantOwnsRepository(
  binding: TenantBinding,
  owner: string,
  name: string
): TenantAccessDenial | null {
  if (binding.repository !== repositoryFullName(owner, name)) {
    return {
      code: "TENANT_MISMATCH",
      message: "This task is bound to a different repository.",
      retryable: false,
      requiredAction: "USE_OWN_RESOURCE",
    };
  }
  return null;
}
