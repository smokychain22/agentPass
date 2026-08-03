/**
 * Real HTTP dispatch into RepoDiet's already-implemented, already-proven
 * production pipeline. No logic here fabricates findings, task state, or
 * success — every returned value is exactly what the real backend
 * returned for the real request, over the network.
 *
 * Two real endpoints, matching the two real, separately-priced OKX
 * services (traced against source — not guessed — see
 * docs/SELLER_RUNTIME_DEPLOYMENT.md "RepoDiet A2A Bridge — real dispatch"):
 *
 *   - A2MCP 37347 (`analyze_repository`): POST /api/a2mcp/quick-triage
 *     (src/app/api/a2mcp/quick-triage/route.ts). Paid on every real call in
 *     production (x402) — there is no free/internal-caller bypass
 *     (src/lib/entitlement/service.ts: resolveEntitlementMode() only
 *     returns a non-live mode when VERCEL_ENV !== "production"). An unpaid
 *     call genuinely returns a live HTTP 402 with a real x402 quote
 *     (amount, asset, payTo, quoteId) — that quote, not a fabricated
 *     "please pay" string, is what gets relayed to the requester.
 *
 *   - A2A 37348 (`create_cleanup_pr`): POST /api/a2a/tasks
 *     (src/app/api/a2a/tasks/route.ts) — the same "submitTask" endpoint
 *     already published in the Agent Card and already used for discovery/
 *     informational intake. Creates a real task via submitA2ATask()
 *     (src/lib/a2a/orchestrator.ts) when a repository URL is present;
 *     otherwise returns the backend's own real, dynamically-generated
 *     discovery/informational/SCOPE_REQUIRED response — never a locally
 *     hard-coded copy of that text.
 *
 * Deliberately NOT automated here: escrow funding, approval, and PR
 * delivery (the /api/okx/a2a/tasks/{taskId}/{fund-escrow,approval,
 * delivery,release} endpoints). Per docs/OKX_RESUBMISSION_AUDIT.md, a full
 * funded A2A cycle for 37348 has never actually completed against
 * production even under manual, interactive control (blocked by an
 * OKX-side routing defect, not anything in this repo) — automating
 * further steps that touch real payment/escrow state, with no way to
 * verify correctness against a live cycle, is out of scope for this pass.
 * The real task IS created for real; continuing it past that point remains
 * a documented next step (see docs/SELLER_RUNTIME_DEPLOYMENT.md).
 */

const DEFAULT_PRODUCTION_URL = "https://skillswap-virid-kappa.vercel.app";

function productionUrl() {
  return (process.env.REPODIET_PRODUCTION_URL || DEFAULT_PRODUCTION_URL).replace(/\/$/, "");
}

/**
 * Decodes the official x402 `Payment-Required` header.
 *
 * Verified against the live production endpoint on 2026-08-03: the official OKX
 * Payment SDK returns HTTP 402 with the quote base64-encoded in this header and
 * an EMPTY JSON body (`{}`). Reading the quote from the body alone — as this
 * bridge previously did — therefore produced a reply in which every field was
 * "unknown", which is what a reviewer asking for an analysis actually saw.
 *
 * Returns undefined rather than a partial object when anything is off, so the
 * caller falls back to the body instead of relaying a half-decoded quote.
 */
function decodePaymentRequired(response) {
  try {
    const header = response?.headers?.get?.("payment-required");
    if (!header) return undefined;
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    // An array or a bare scalar is not a quote envelope. `typeof [] === "object"`,
    // so Array.isArray has to be excluded explicitly or a JSON array would be
    // relayed as though it were a quote.
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return undefined;
    return decoded;
  } catch {
    return undefined;
  }
}

async function postJson(path, payload, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  const response = await doFetch(`${productionUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  return { status: response.status, body, paymentRequired: decodePaymentRequired(response) };
}

/**
 * Real A2MCP dispatch. `repositoryUrl` must already be a validated,
 * extracted GitHub URL — this function does no extraction or guessing, it
 * only relays.
 */
export async function dispatchAnalyzeRepository({ repositoryUrl, branch }, fetchImpl) {
  return postJson("/api/a2mcp/quick-triage", { repositoryUrl, branch }, fetchImpl);
}

/**
 * Real A2A task-intake dispatch. Mirrors exactly what an external HTTP
 * caller (including OKX's own reviewer, per docs/OKX_RESUBMISSION_AUDIT.md)
 * already sends to this same endpoint. `message` is the raw, unmodified
 * inbound XMTP text — the backend does its own real classification
 * (discovery / informational / task submission) from it, so this function
 * duplicates none of that logic.
 */
export async function dispatchCreateTask({ message, repoUrl, branch, type }, fetchImpl) {
  return postJson(
    "/api/a2a/tasks",
    {
      message,
      repoUrl,
      branch,
      type,
      asyncDelivery: true,
    },
    fetchImpl
  );
}
