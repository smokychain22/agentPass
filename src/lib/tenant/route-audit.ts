/**
 * Public ID routes that must enforce tenant boundaries on read/write.
 * Keep this list updated when adding marketplace endpoints.
 */
export const TENANT_ISOLATION_ROUTE_AUDIT = [
  {
    route: "GET /api/deep-scans/[id]",
    resource: "deep_scan_job",
    status: "implemented",
    note: "Resolves x-repodiet-tenant-id / buyer headers and denies cross-tenant reads with 404.",
  },
  {
    route: "GET /api/a2a/tasks/[taskId]",
    resource: "task",
    status: "partial",
    note: "Session owner check present; OKX buyer header binding still required for marketplace clients.",
  },
  {
    route: "GET /api/scans/[scanId]",
    resource: "scan",
    status: "implemented",
    note: "Tenant header ownership check; legacy unbound scans denied when REPODIET_REQUIRE_TENANT_BINDING=1.",
  },
  {
    route: "GET /api/findings/*",
    resource: "findings",
    status: "implemented",
    note: "Tenant header ownership check on stored findings.",
  },
  {
    route: "GET /api/okx/receipts/[id]",
    resource: "receipt",
    status: "required",
  },
  {
    route: "GET /api/attestations/*",
    resource: "attestation",
    status: "required",
  },
  {
    route: "GET /proof/green-pr/[id]",
    resource: "proof",
    status: "required",
  },
  {
    route: "POST /api/okx/intake/repository",
    resource: "task",
    status: "implemented",
    note: "Creates tenant-bound deep scan idempotency key.",
  },
  {
    route: "POST /api/deep-scans",
    resource: "deep_scan_job",
    status: "implemented",
    note: "Tenant binding + capacity QUEUED/CAPACITY_LIMIT; no allowlist.",
  },
] as const;
