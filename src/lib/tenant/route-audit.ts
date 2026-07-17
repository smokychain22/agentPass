/**
 * Public ID routes that must enforce tenant boundaries on read/write.
 * Keep this list updated when adding marketplace endpoints.
 */
export const TENANT_ISOLATION_ROUTE_AUDIT = [
  {
    route: "GET /api/deep-scans/[id]",
    resource: "deep_scan_job",
    status: "partial",
    note: "Job IDs are unguessable; tenantId binding added on create. Cross-tenant read hardening pending explicit auth header.",
  },
  {
    route: "GET /api/a2a/tasks/[taskId]",
    resource: "task",
    status: "required",
    note: "Must bind okxBuyerId/buyerWallet before exposing private findings.",
  },
  {
    route: "GET /api/scans/[scanId]",
    resource: "scan",
    status: "required",
  },
  {
    route: "GET /api/findings/*",
    resource: "findings",
    status: "required",
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
    note: "Tenant binding + public intake validation; no allowlist.",
  },
] as const;
