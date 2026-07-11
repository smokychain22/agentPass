import assert from "node:assert/strict";
import { A2MCP_SERVICES, A2A_SERVICES, getA2mcpService } from "../src/lib/okx/services";
import { buildOkxHealthResponse } from "../src/lib/okx/health";
import { isOkxPaidMode } from "../src/lib/okx/entitlement";
import { priceForOperation } from "../src/lib/payment/quote-service";
import { buildCommerceBinding } from "../src/lib/okx/commerce-gateway";

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

  await test("A2MCP service catalog has five launch tools", () => {
    assert.equal(Object.keys(A2MCP_SERVICES).length, 5);
    assert.equal(getA2mcpService("analyze_repository")?.amountMicro, "30000");
    assert.equal(getA2mcpService("scan_repository")?.amountMicro, "10000");
  });

  await test("A2A services require escrow", () => {
    for (const svc of Object.values(A2A_SERVICES)) {
      assert.equal(svc.requiresEscrow, true);
      assert.equal(svc.requiresApproval, true);
    }
  });

  await test("analyze_repository price is 0.03 USDT", () => {
    const price = priceForOperation("analyze_repository");
    assert.equal(price.amountMicro, "30000");
    assert.equal(price.priceLabel, "0.03 USDT");
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

  await test("OKX health response includes hybrid architecture", () => {
    const health = buildOkxHealthResponse();
    assert.equal(health.ok, true);
    assert.equal(health.architecture.a2mcp, "fixed-price x402 per call");
    assert.match(health.architecture.doubleChargePolicy, /never pays A2MCP/i);
    assert.ok(health.services.length >= 8);
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
