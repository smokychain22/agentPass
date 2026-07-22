import assert from "node:assert/strict";
import {
  A2MCP_SERVICES,
  A2A_SERVICES,
  getA2mcpService,
  listOkxServices,
  OKX_A2A_PUBLIC_OPERATION,
} from "../src/lib/okx/services";
import { buildOkxHealthResponse } from "../src/lib/okx/health";
import { isOkxPaidMode } from "../src/lib/okx/entitlement";
import { priceForOperation } from "../src/lib/payment/quote-service";
import { getAnalyzeRepositoryPrice } from "../src/lib/payment/analyze-repository-price";
import { buildCommerceBinding } from "../src/lib/okx/commerce-gateway";
import { buildAgentCard } from "../src/lib/a2a/agent-card";
import { buildServiceManifest } from "../src/lib/a2mcp/tool-manifest";

function test(name: string, fn: () => void | Promise<void>) {
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

async function run() {
  console.log("OKX commerce gateway tests");

  await test("internal A2MCP catalog retains supported legacy tools", () => {
    assert.equal(Object.keys(A2MCP_SERVICES).length, 5);
    const analyzePrice = priceForOperation("analyze_repository");
    assert.equal(getA2mcpService("analyze_repository")?.amountMicro, analyzePrice.amountMicro);
    assert.equal(getA2mcpService("scan_repository")?.amountMicro, "10000");
  });

  await test("A2A services require escrow", () => {
    for (const svc of Object.values(A2A_SERVICES)) {
      assert.equal(svc.requiresEscrow, true);
      assert.equal(svc.requiresApproval, true);
    }
  });

  await test("public A2A catalog uses the canonical operation without renaming the internal service", () => {
    const publicA2a = listOkxServices().find((service) => service.serviceType === "A2A");
    assert.equal(publicA2a?.operation, OKX_A2A_PUBLIC_OPERATION);
    assert.equal(publicA2a?.operation, "create_cleanup_pr");
    assert.equal(A2A_SERVICES.verified_cleanup_pr.operation, "verified_cleanup_pr");
  });

  await test("agent card and tools manifest preserve canonical public operations and pricing", () => {
    const card = buildAgentCard();
    assert.equal(card.services.a2a.operation, "create_cleanup_pr");
    assert.equal(card.services.a2a.price, "negotiated");
    assert.equal(card.services.a2a.defaultReferencePrice, "1 USD₮0");
    assert.equal(card.services.a2mcp.operation, "analyze_repository");
    assert.equal(card.services.a2mcp.price, "0.03 USD₮0 per call");

    const manifest = buildServiceManifest();
    assert.equal(manifest.pricing.a2aVerifiedCleanupPr.operation, "create_cleanup_pr");
    assert.equal(manifest.pricing.a2aVerifiedCleanupPr.pricing, "negotiated");
    assert.equal(manifest.pricing.a2aVerifiedCleanupPr.defaultReferenceUsdT0, 1);
    assert.equal(manifest.pricing.a2mcpQuickTriage.operation, "analyze_repository");
    assert.equal(manifest.pricing.a2mcpQuickTriage.priceUsdT0, 0.03);
  });

  await test("analyze_repository price follows pricing module", () => {
    const price = priceForOperation("analyze_repository");
    assert.equal(price.amountMicro, getAnalyzeRepositoryPrice().amountMicro);
    assert.equal(price.priceLabel, getAnalyzeRepositoryPrice().priceLabel);
  });

  await test("commerce binding includes request hash", () => {
    const binding = buildCommerceBinding({
      operation: "analyze_repository",
      repository: "owner/repo",
      branch: "main",
      commitSha: "abc123",
    });
    assert.match(binding.requestHash, /^sha256:/);
  });

  await test("OKX health response includes hybrid architecture", async () => {
    const health = await buildOkxHealthResponse();
    // ok tracks overallReady (fail-closed). Architecture/services always present.
    assert.equal(typeof health.ok, "boolean");
    assert.equal(typeof health.overallReady, "boolean");
    assert.equal(typeof health.workerReady, "boolean");
    assert.equal(typeof health.a2aRuntimeReady, "boolean");
    assert.equal(health.architecture.a2mcp, "fixed-price x402 per call");
    assert.match(health.architecture.doubleChargePolicy, /never pays A2MCP/i);
    assert.deepEqual(
      health.services.map((service) => service.serviceId),
      ["analyze_repository", "verified_cleanup_pr"]
    );
  });

  await test("paid mode respects REPODIET_OKX_A2MCP_PAID", () => {
    const prev = process.env.REPODIET_OKX_A2MCP_PAID;
    process.env.REPODIET_OKX_A2MCP_PAID = "1";
    assert.equal(isOkxPaidMode(), true);
    process.env.REPODIET_OKX_A2MCP_PAID = prev;
  });

  console.log("All OKX commerce gateway tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
