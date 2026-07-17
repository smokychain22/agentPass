/**
 * Tenant-scoped resource route matrix for marketplace isolation.
 * Headers alone are not auth — prefer session / payment / GitHub binding.
 */
export const TENANT_ROUTE_MATRIX = [
  {
    route: "GET /api/deep-scans/[id]",
    resource: "deep_scan_job",
    authentication: "tenant headers + optional session",
    tenantCheck: "implemented",
    workerOnly: false,
    publicFields: "status, stage, progress, redacted claim token",
    negativeTest: "wrong tenant → 404 TASK_NOT_FOUND",
  },
  {
    route: "GET /api/scans/[scanId]",
    resource: "scan",
    authentication: "tenant headers / ownerKey",
    tenantCheck: "implemented",
    workerOnly: false,
    publicFields: "scan payload when owned",
    negativeTest: "wrong tenant → 404",
  },
  {
    route: "GET /api/findings/[scanId]",
    resource: "findings",
    authentication: "tenant headers",
    tenantCheck: "implemented",
    workerOnly: false,
    publicFields: "findings when owned",
    negativeTest: "wrong tenant → 404",
  },
  {
    route: "GET /api/a2a/tasks/[taskId]",
    resource: "task",
    authentication: "browser session owner",
    tenantCheck: "partial — session bound; OKX buyer cryptographic bind pending",
    workerOnly: false,
    publicFields: "task status for owner",
    negativeTest: "other session → 403",
  },
  {
    route: "GET /api/okx/receipts/[receiptId]",
    resource: "receipt",
    authentication: "required",
    tenantCheck: "hardening",
    workerOnly: false,
    publicFields: "none until ownership verified",
    negativeTest: "wrong tenant → 404",
  },
  {
    route: "GET /api/attestations/[id]",
    resource: "attestation",
    authentication: "required",
    tenantCheck: "hardening",
    workerOnly: false,
    publicFields: "public verify endpoint only",
    negativeTest: "wrong tenant → 404",
  },
  {
    route: "GET /api/green-pr/contracts/[id]",
    resource: "contract",
    authentication: "required",
    tenantCheck: "hardening",
    workerOnly: false,
    publicFields: "none until ownership verified",
    negativeTest: "wrong tenant → 404",
  },
  {
    route: "POST /api/internal/worker/*",
    resource: "worker",
    authentication: "WORKER_API_KEY bearer",
    tenantCheck: "n/a",
    workerOnly: true,
    publicFields: "none",
    negativeTest: "missing/invalid key → 401; tenants cannot call",
  },
] as const;

export const TENANT_ISOLATION_ROUTE_AUDIT = TENANT_ROUTE_MATRIX.map((row) => ({
  route: row.route,
  resource: row.resource,
  status:
    row.tenantCheck === "implemented"
      ? "implemented"
      : row.workerOnly
        ? "implemented"
        : row.tenantCheck === "partial — session bound; OKX buyer cryptographic bind pending"
          ? "partial"
          : "required",
  note: `${row.authentication}; ${row.negativeTest}`,
}));
