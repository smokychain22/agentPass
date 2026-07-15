import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/** Mirrors quote-service createBoundQuote commercial digest. */
function quoteCommercialDigest(parts: Record<string, string | string[]>): {
  canonical: string;
  digest: string;
} {
  const canonical = JSON.stringify(parts, Object.keys(parts).sort());
  return {
    canonical,
    digest: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
  };
}

/** Mirrors commerce-gateway bindingRequestHash. */
function executionBindingDigest(binding: {
  operation: string;
  repository: string;
  branch: string;
  commitSha: string;
  findingIds: string[];
}): { canonical: string; digest: string } {
  const canonical = JSON.stringify({
    operation: binding.operation,
    repository: binding.repository,
    branch: binding.branch,
    commitSha: binding.commitSha,
    findingIds: [...binding.findingIds].sort(),
  });
  return {
    canonical,
    digest: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
  };
}

async function run() {
  console.log("A2MCP digest layers");

  const quote = quoteCommercialDigest({
    operation: "analyze_repository",
    repository: "smokychain22/agentPass",
    branch: "main",
    commitSha: "pending_scan",
    findingIds: [],
    scanId: "",
    transformedSourceHashes: "",
    verificationProfile: "standard",
    contractDigest: "",
    amountMicro: "30000",
    currency: "USDT",
    network: "eip155:196",
    recipient: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    nonce: "19e02ad0cfbf713a3aaf1f4e28d53c73",
    expiresAt: "2026-07-15T20:41:59.709Z",
  });
  assert.equal(
    quote.digest,
    "sha256:eaf3dbd6c09347190fd1502a25490462f5a4d519d2b1f2b77776e225449f9937"
  );

  const exec = executionBindingDigest({
    operation: "analyze_repository",
    repository: "smokychain22/agentPass",
    branch: "main",
    commitSha: "pending_scan",
    findingIds: [],
  });
  assert.equal(
    exec.digest,
    "sha256:6719e581938926354c2e06ad60fd01913729aaf964da171ae513fa3cb91a6efc"
  );

  assert.notEqual(quote.digest, exec.digest);
  assert.match(quote.canonical, /amountMicro/);
  assert.match(quote.canonical, /nonce/);
  assert.doesNotMatch(exec.canonical, /amountMicro/);

  console.log("  quoteCommercialDigest layers distinct intentional commercial vs execution binding");
  console.log("A2MCP digest layers: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
