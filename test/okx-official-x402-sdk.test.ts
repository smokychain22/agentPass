import assert from "node:assert/strict";
import {
  OfficialX402ConfigError,
  readOfficialX402Credentials,
  readPayToAddress,
  priceStringFromMicro,
  buildRouteConfig,
  createNextHttpAdapter,
  resetOfficialResourceServerCache,
  OKX_X402_NETWORK,
  A2MCP_ROUTE_PATTERN,
} from "../src/lib/payment/okx-official-x402";

function test(name: string, fn: () => Promise<void> | void) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}`);
      throw err;
    }
  })();
}

/**
 * OKX rejected listing 9636 on 2026-08-02:
 *
 *   "your service is not integrated with the official OKX Payment SDK, which
 *    prevents us from completing verification"
 *
 * That was accurate — no @okxweb3 payment package was installed and both the
 * 402 challenge and the verification were hand-rolled. These tests pin the
 * things that make the migration real rather than cosmetic: the official
 * packages are genuinely imported and constructed, the commercial terms are
 * unchanged, and the boundary fails closed instead of degrading into free
 * service when credentials are absent.
 */
async function run() {
  console.log("okx-official-x402-sdk");

  // --- the official packages are genuinely present and wired ------------

  await test("the official OKX SDK packages are real dependencies, not stubs", async () => {
    const core = await import("@okxweb3/x402-core");
    const server = await import("@okxweb3/x402-core/server");
    const evm = await import("@okxweb3/x402-evm/exact/server");
    assert.equal(typeof core.OKXFacilitatorClient, "function", "OKXFacilitatorClient must be a real class");
    assert.equal(typeof server.x402ResourceServer, "function");
    assert.equal(typeof server.x402HTTPResourceServer, "function");
    assert.equal(typeof evm.ExactEvmScheme, "function");
  });

  await test("the SDK is declared as a production dependency", async () => {
    const pkg = (await import("../package.json", { with: { type: "json" } })).default as {
      dependencies: Record<string, string>;
    };
    for (const name of ["@okxweb3/x402-core", "@okxweb3/x402-evm", "@okxweb3/x402-express"]) {
      assert.ok(pkg.dependencies[name], `${name} must be a production dependency`);
    }
  });

  await test("the facilitator client constructs with the documented OKXConfig shape", async () => {
    const { OKXFacilitatorClient } = await import("@okxweb3/x402-core");
    const client = new OKXFacilitatorClient({
      apiKey: "test-key",
      secretKey: "test-secret",
      passphrase: "test-pass",
    });
    // The documented seller surface: verify + settle against the OKX broker.
    assert.equal(typeof client.verify, "function");
    assert.equal(typeof client.settle, "function");
    assert.equal(typeof client.getSupported, "function");
  });

  await test("the EVM exact scheme registers on the resource server for X Layer", async () => {
    const { OKXFacilitatorClient } = await import("@okxweb3/x402-core");
    const { x402ResourceServer } = await import("@okxweb3/x402-core/server");
    const { ExactEvmScheme } = await import("@okxweb3/x402-evm/exact/server");
    const rs = new x402ResourceServer(
      new OKXFacilitatorClient({ apiKey: "k", secretKey: "s", passphrase: "p" })
    );
    rs.register(OKX_X402_NETWORK, new ExactEvmScheme());
    assert.equal(OKX_X402_NETWORK, "eip155:196", "X Layer mainnet must not change");
  });

  // --- commercial terms are preserved exactly ---------------------------

  await test("0.03 USDT is expressed as the USD string the SDK expects", () => {
    assert.equal(priceStringFromMicro("30000"), "$0.03");
    assert.equal(priceStringFromMicro("1000000"), "$1");
    assert.equal(priceStringFromMicro("200000"), "$0.2");
  });

  await test("the route config keeps price, network and payee unchanged", () => {
    const cfg = buildRouteConfig({
      PAY_TO_ADDRESS: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
    } as unknown as NodeJS.ProcessEnv);
    const accepts = Array.isArray(cfg.accepts) ? cfg.accepts : [cfg.accepts];
    assert.equal(accepts[0].network, "eip155:196");
    assert.equal(accepts[0].scheme, "exact");
    assert.equal(accepts[0].payTo, "0xaa895234c3fc31c40018eef975db6ac79bf87f1a");
    assert.equal(accepts[0].price, "$0.03");
  });

  await test("the protected route is exactly the registered A2MCP endpoint", () => {
    assert.equal(A2MCP_ROUTE_PATTERN, "POST /api/a2mcp/quick-triage");
  });

  // --- fails closed, never degrades to free ------------------------------

  await test("missing OKX Developer Portal credentials fail closed and name what is missing", () => {
    resetOfficialResourceServerCache();
    assert.throws(
      () => readOfficialX402Credentials({} as unknown as NodeJS.ProcessEnv),
      (err: unknown) => {
        assert.ok(err instanceof OfficialX402ConfigError);
        assert.deepEqual(err.missing, ["OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE"]);
        return true;
      },
      "a missing credential must never silently disable payment"
    );
  });

  await test("a partially configured boundary is still refused", () => {
    assert.throws(
      () =>
        readOfficialX402Credentials({
          OKX_API_KEY: "k",
          OKX_SECRET_KEY: "  ",
        } as unknown as NodeJS.ProcessEnv),
      (err: unknown) => {
        assert.ok(err instanceof OfficialX402ConfigError);
        assert.deepEqual(err.missing, ["OKX_SECRET_KEY", "OKX_PASSPHRASE"]);
        return true;
      }
    );
  });

  await test("a missing payee address is refused rather than defaulted", () => {
    assert.throws(
      () => readPayToAddress({} as unknown as NodeJS.ProcessEnv),
      (err: unknown) => err instanceof OfficialX402ConfigError
    );
  });

  await test("an optional OKX_BASE_URL override is honoured, absent by default", () => {
    const base = { OKX_API_KEY: "k", OKX_SECRET_KEY: "s", OKX_PASSPHRASE: "p" };
    assert.equal(readOfficialX402Credentials(base as unknown as NodeJS.ProcessEnv).baseUrl, undefined);
    assert.equal(
      readOfficialX402Credentials({
        ...base,
        OKX_BASE_URL: "https://web3.okx.com",
      } as unknown as NodeJS.ProcessEnv).baseUrl,
      "https://web3.okx.com"
    );
  });

  // --- the Next.js adapter satisfies the SDK's HTTPAdapter contract ------

  await test("the Next adapter exposes everything the SDK's HTTPAdapter requires", () => {
    const req = new Request("https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage?x=1", {
      method: "POST",
      headers: {
        accept: "application/json",
        "user-agent": "okx-reviewer/1.0",
        "payment-signature": "sig-abc",
      },
    });
    const a = createNextHttpAdapter(req, { repositoryUrl: "https://github.com/o/r" });
    assert.equal(a.getMethod(), "POST");
    assert.equal(a.getPath(), "/api/a2mcp/quick-triage");
    assert.equal(a.getAcceptHeader(), "application/json");
    assert.equal(a.getUserAgent(), "okx-reviewer/1.0");
    assert.equal(a.getHeader("payment-signature"), "sig-abc");
    assert.equal(a.getHeader("nope"), undefined);
    assert.equal(a.getQueryParam?.("x"), "1");
    assert.deepEqual(a.getBody?.(), { repositoryUrl: "https://github.com/o/r" });
  });

  await test("the adapter reports the body given to it — a Request body is single-use", () => {
    const req = new Request("https://example.com/api/a2mcp/quick-triage", { method: "POST" });
    assert.equal(createNextHttpAdapter(req).getBody?.(), undefined);
  });

  // --- the custom gate is no longer the production authority -------------

  await test("the production route hands payment to the official SDK, not the custom gate", async () => {
    const fs = await import("node:fs");
    const route = fs.readFileSync("src/app/api/a2mcp/quick-triage/route.ts", "utf8");
    assert.match(route, /processOfficialPayment/, "route must run the official SDK boundary");
    assert.match(route, /settleOfficialPayment/, "route must settle through the official SDK");
    assert.match(
      route,
      /officialSdkVerifiedPayment/,
      "route must tell the pipeline the official SDK already verified payment"
    );
  });

  await test("the custom gate is skipped whenever the official SDK verified the request", async () => {
    const fs = await import("node:fs");
    const pipeline = fs.readFileSync("src/lib/a2mcp/phase3-route.ts", "utf8");
    assert.match(
      pipeline,
      /options\?\.officialSdkVerifiedPayment[\s\S]{0,400}gateA2mcpCall/,
      "gateA2mcpCall must be the else-branch, never a fallback second opinion"
    );
  });

  await test("BOTH operations on the registered endpoint go through the official boundary", async () => {
    const fs = await import("node:fs");
    const route = fs.readFileSync("src/app/api/a2mcp/quick-triage/route.ts", "utf8");
    const calls = route.match(/runOfficialPaymentBoundary\(/g) ?? [];
    // One definition + two call sites (green-pr verification and quick triage).
    assert.ok(
      calls.length >= 3,
      `the green_pr_verification branch shares this endpoint and its 0.03 rail, so it must not bypass the official SDK (found ${calls.length} references)`
    );
    // The green-pr branch must not reach runPhase3ToolRoute before the boundary.
    const greenPrBranch = route.slice(
      route.indexOf("isGreenPrVerificationOperation(requestedOperation)"),
      route.indexOf("const branch =")
    );
    assert.match(greenPrBranch, /runOfficialPaymentBoundary/);
    assert.ok(
      greenPrBranch.indexOf("runOfficialPaymentBoundary") <
        greenPrBranch.indexOf("runPhase3ToolRoute"),
      "payment must be settled by the official SDK before execution, not after"
    );
  });

  await test("settlement only happens on a successful execution", async () => {
    const fs = await import("node:fs");
    const route = fs.readFileSync("src/app/api/a2mcp/quick-triage/route.ts", "utf8");
    assert.match(
      route,
      /executed\.status < 200 \|\| executed\.status >= 300\) return executed/,
      "a failed execution must never settle a payment"
    );
  });

  await test("configured-state detection distinguishes 'not configured' from 'facilitator down'", async () => {
    const { isOfficialBoundaryConfigured } = await import("../src/lib/payment/okx-official-x402");
    assert.equal(isOfficialBoundaryConfigured({} as unknown as NodeJS.ProcessEnv), false);
    assert.equal(
      isOfficialBoundaryConfigured({
        OKX_API_KEY: "k",
        OKX_SECRET_KEY: "s",
        OKX_PASSPHRASE: "p",
      } as unknown as NodeJS.ProcessEnv),
      false,
      "credentials without a payee are still not a usable boundary"
    );
    assert.equal(
      isOfficialBoundaryConfigured({
        OKX_API_KEY: "k",
        OKX_SECRET_KEY: "s",
        OKX_PASSPHRASE: "p",
        PAY_TO_ADDRESS: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
      } as unknown as NodeJS.ProcessEnv),
      true
    );
  });

  await test("initialization is retried, because it is a live facilitator round-trip", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/payment/okx-official-x402.ts", "utf8");
    assert.match(src, /INITIALIZE_ATTEMPTS\s*=\s*[2-9]/, "a single cold-start blip must not 503 the endpoint");
    assert.match(
      src,
      /for \(let attempt = 1; attempt <= INITIALIZE_ATTEMPTS/,
      "initialize() must be retried, not called once"
    );
    assert.match(
      src,
      /throw lastError/,
      "after exhausting retries it must still fail closed, never serve the service free"
    );
  });

  console.log("okx-official-x402-sdk: all passed");
}

run();
