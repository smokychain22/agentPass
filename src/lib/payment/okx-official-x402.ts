/**
 * Official OKX Payment Seller SDK boundary for the registered A2MCP service
 * 37347 (`POST /api/a2mcp/quick-triage`).
 *
 * WHY THIS EXISTS — OKX rejected listing 9636 on 2026-08-02 with:
 *
 *   "We've detected that your service is not integrated with the official OKX
 *    Payment SDK, which prevents us from completing verification. Please refer
 *    to the integration guide […/payments/service-seller-sdk] to migrate to the
 *    official SDK, then resubmit your listing application."
 *
 * That was accurate: the 402 challenge and the payment verification were both
 * hand-rolled, and no @okxweb3 payment package was installed at all.
 *
 * This module makes the official SDK the ONLY thing that mints the 402 and the
 * ONLY thing that verifies and settles payment for that route. It is not a
 * wrapper around our own logic and it does not re-implement the protocol: the
 * PAYMENT-REQUIRED challenge, the signature verification and the settlement
 * all come from `@okxweb3/x402-core` + `@okxweb3/x402-evm`, talking to the OKX
 * facilitator with the OKX Developer Portal credentials.
 *
 * The published guide's Node.js example uses `paymentMiddleware` from
 * `@okxweb3/x402-express`. This service is a Next.js App Router route handler,
 * not Express, so it uses the framework-agnostic surface the same package tree
 * exposes for exactly this case — `x402HTTPResourceServer` driven by an
 * `HTTPAdapter` — rather than bolting Express into the app. Same SDK, same
 * scheme registration, same facilitator; only the transport adapter differs.
 *
 * Commercial terms are unchanged and are read from the existing canonical
 * sources: price 0.03 USDT, network eip155:196 (X Layer), payTo the existing
 * seller wallet. This module must never alter them.
 */
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { x402ResourceServer, x402HTTPResourceServer } from "@okxweb3/x402-core/server";
import type {
  HTTPAdapter,
  HTTPRequestContext,
  RouteConfig,
} from "@okxweb3/x402-core/server";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { getAnalyzeRepositoryPrice } from "@/lib/payment/analyze-repository-price";

/** X Layer mainnet. Never change this without an explicit listing update. */
export const OKX_X402_NETWORK = "eip155:196";

/** The registered A2MCP endpoint, exactly as listed for service 37347. */
export const A2MCP_ROUTE_PATTERN = "POST /api/a2mcp/quick-triage";

export class OfficialX402ConfigError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(
      `Official OKX Payment SDK is not configured: missing ${missing.join(", ")}. ` +
        `The A2MCP payment boundary cannot operate without OKX Developer Portal credentials.`
    );
    this.name = "OfficialX402ConfigError";
    this.missing = missing;
  }
}

/**
 * Reads the OKX Developer Portal credentials. Fails closed and names exactly
 * what is missing — a half-configured payment boundary must never silently
 * degrade into "no payment required".
 */
export function readOfficialX402Credentials(env: NodeJS.ProcessEnv = process.env): {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  baseUrl?: string;
} {
  const apiKey = env.OKX_API_KEY?.trim() ?? "";
  const secretKey = env.OKX_SECRET_KEY?.trim() ?? "";
  const passphrase = env.OKX_PASSPHRASE?.trim() ?? "";
  const missing: string[] = [];
  if (!apiKey) missing.push("OKX_API_KEY");
  if (!secretKey) missing.push("OKX_SECRET_KEY");
  if (!passphrase) missing.push("OKX_PASSPHRASE");
  if (missing.length > 0) throw new OfficialX402ConfigError(missing);
  const baseUrl = env.OKX_BASE_URL?.trim();
  return { apiKey, secretKey, passphrase, ...(baseUrl ? { baseUrl } : {}) };
}

/**
 * The seller wallet. Uses the existing configured address; this module is not
 * permitted to introduce a different payee.
 */
export function readPayToAddress(env: NodeJS.ProcessEnv = process.env): string {
  const payTo = (env.PAY_TO_ADDRESS ?? env.REPODIET_PAY_TO ?? "").trim();
  if (!payTo) {
    throw new OfficialX402ConfigError(["PAY_TO_ADDRESS"]);
  }
  return payTo;
}

/**
 * Converts the canonical micro-USDT price into the USD string the SDK expects
 * ("$0.03"). The SDK converts that to the network's stablecoin atomic units
 * itself, which is why the guide keeps prices as USD strings.
 */
export function priceStringFromMicro(amountMicro: string): string {
  const micro = BigInt(amountMicro);
  const scale = BigInt(1000000);
  const whole = micro / scale;
  const frac = (micro % scale).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `$${whole}.${frac}` : `$${whole}`;
}

/** Route configuration derived from the existing canonical commercial terms. */
export function buildRouteConfig(env: NodeJS.ProcessEnv = process.env): RouteConfig {
  const price = getAnalyzeRepositoryPrice();
  return {
    accepts: [
      {
        scheme: "exact",
        network: OKX_X402_NETWORK,
        payTo: readPayToAddress(env),
        price: priceStringFromMicro(price.amountMicro),
        maxTimeoutSeconds: 300,
      },
    ],
    description: "RepoDiet Quick Triage — evidence-backed repository analysis",
    mimeType: "application/json",
  } as RouteConfig;
}

/**
 * Adapts a Web `Request` (Next.js App Router) to the SDK's transport-agnostic
 * `HTTPAdapter`. The body is passed in already-parsed because the route reads
 * it once; a Request body can only be consumed a single time.
 */
export function createNextHttpAdapter(request: Request, parsedBody?: unknown): HTTPAdapter {
  const url = new URL(request.url);
  return {
    getHeader: (name: string) => request.headers.get(name) ?? undefined,
    getMethod: () => request.method.toUpperCase(),
    getPath: () => url.pathname,
    getUrl: () => request.url,
    getAcceptHeader: () => request.headers.get("accept") ?? "",
    getUserAgent: () => request.headers.get("user-agent") ?? "",
    getQueryParams: () => Object.fromEntries(url.searchParams.entries()),
    getQueryParam: (name: string) => url.searchParams.get(name) ?? undefined,
    getBody: () => parsedBody,
  };
}

let cachedServer: x402HTTPResourceServer | undefined;
let cachedServerKey: string | undefined;

/**
 * Builds (once) the official resource server: OKX facilitator client, the EVM
 * `exact` scheme registered for X Layer, and the route's payment terms.
 */
export async function getOfficialResourceServer(
  env: NodeJS.ProcessEnv = process.env
): Promise<x402HTTPResourceServer> {
  const creds = readOfficialX402Credentials(env);
  const route = buildRouteConfig(env);
  // Rebuild if credentials or terms change (tests, price override, rotation).
  const key = JSON.stringify({ a: creds.apiKey.slice(0, 4), r: route });
  if (cachedServer && cachedServerKey === key) return cachedServer;

  const facilitator = new OKXFacilitatorClient({
    apiKey: creds.apiKey,
    secretKey: creds.secretKey,
    passphrase: creds.passphrase,
    ...(creds.baseUrl ? { baseUrl: creds.baseUrl } : {}),
  });

  const resourceServer = new x402ResourceServer(facilitator);
  resourceServer.register(OKX_X402_NETWORK, new ExactEvmScheme());

  const httpServer = new x402HTTPResourceServer(resourceServer, {
    [A2MCP_ROUTE_PATTERN]: route,
  });
  await httpServer.initialize();

  cachedServer = httpServer;
  cachedServerKey = key;
  return httpServer;
}

/** Test seam: drop the memoized server so config changes take effect. */
export function resetOfficialResourceServerCache(): void {
  cachedServer = undefined;
  cachedServerKey = undefined;
}

export type OfficialPaymentOutcome =
  | {
      kind: "unpaid";
      /** The SDK's own 402 — PAYMENT-REQUIRED header and body, verbatim. */
      status: number;
      headers: Record<string, string>;
      body: unknown;
    }
  | {
      kind: "verified";
      paymentPayload: unknown;
      paymentRequirements: unknown;
      declaredExtensions?: Record<string, unknown>;
    };

/**
 * Runs the official payment boundary for one request.
 *
 * Every outcome originates in the SDK: an unpaid or invalid request yields the
 * SDK's own 402 instructions (never a locally-composed challenge), and a paid
 * request is verified against the OKX facilitator before any analysis runs.
 */
export async function processOfficialPayment(
  request: Request,
  parsedBody: unknown,
  env: NodeJS.ProcessEnv = process.env
): Promise<OfficialPaymentOutcome> {
  const server = await getOfficialResourceServer(env);
  const adapter = createNextHttpAdapter(request, parsedBody);
  const context: HTTPRequestContext = {
    adapter,
    path: adapter.getPath(),
    method: adapter.getMethod(),
    paymentHeader: adapter.getHeader("payment-signature"),
    routePattern: A2MCP_ROUTE_PATTERN,
  };

  const result = await server.processHTTPRequest(context);

  if (result.type === "payment-error") {
    return {
      kind: "unpaid",
      status: result.response.status,
      headers: result.response.headers,
      body: result.response.body,
    };
  }
  if (result.type === "payment-verified") {
    return {
      kind: "verified",
      paymentPayload: result.paymentPayload,
      paymentRequirements: result.paymentRequirements,
      declaredExtensions: result.declaredExtensions,
    };
  }
  // "no-payment-required" would mean the route is unprotected. For a paid
  // marketplace service that is a misconfiguration, not a free pass.
  throw new OfficialX402ConfigError([`route ${A2MCP_ROUTE_PATTERN} is not payment-protected`]);
}

/**
 * Settles a verified payment through the official SDK after the service has
 * produced its result, returning the headers (including PAYMENT-RESPONSE)
 * that must be attached to the 200.
 */
export async function settleOfficialPayment(
  paymentPayload: unknown,
  paymentRequirements: unknown,
  declaredExtensions?: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ success: boolean; headers: Record<string, string>; errorReason?: string }> {
  const server = await getOfficialResourceServer(env);
  const settled = await server.processSettlement(
    paymentPayload as never,
    paymentRequirements as never,
    declaredExtensions
  );
  return settled.success
    ? { success: true, headers: settled.headers }
    : { success: false, headers: settled.headers, errorReason: settled.errorReason };
}
