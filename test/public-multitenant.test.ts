import assert from "node:assert/strict";
import {
  assertSameTenant,
  buildTenantBinding,
  tenantIdFromBuyer,
} from "../src/lib/tenant/types";
import { isPrivilegedRepository, PRODUCTION_BYPASS_AUDIT } from "../src/lib/product/bypass-audit";
import {
  REPOSITORY_SUPPORT_MATRIX,
  unsupportedRepositoryResponse,
  classifyPrimaryLanguage,
} from "../src/lib/product/support-matrix";
import { validateGitHubRepositoryUrl } from "../src/lib/product/public-intake";
import { buildMarketplaceIntakeResponse } from "../src/lib/a2a/marketplace-intake";
import { TENANT_ISOLATION_ROUTE_AUDIT } from "../src/lib/tenant/route-audit";
import { PUBLIC_CAPACITY_LIMITS } from "../src/lib/product/capacity-limits";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("public-multitenant");

test("no repository is privileged by name", () => {
  assert.equal(isPrivilegedRepository("velz-cmd", "Meridian"), false);
  assert.equal(isPrivilegedRepository("smokychain22", "agentPass"), false);
  assert.equal(isPrivilegedRepository("velz-cmd", "repodiet-e2e-test"), false);
  assert.equal(isPrivilegedRepository("any", "customer-app"), false);
});

test("tenant mismatch does not leak existence", () => {
  const denial = assertSameTenant("tenant_a", "tenant_b");
  assert.ok(denial);
  assert.equal(denial!.code, "RESOURCE_NOT_FOUND");
  assert.match(denial!.message, /not found/i);
});

test("tenant binding is deterministic per buyer wallet", () => {
  const a = buildTenantBinding({
    buyerWallet: "0xAA895234c3fc31c40018eef975db6ac79bf87f1a",
    repositoryOwner: "acme",
    repositoryName: "app",
  });
  const b = buildTenantBinding({
    buyerWallet: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
    repositoryOwner: "acme",
    repositoryName: "app",
  });
  assert.equal(a.tenantId, b.tenantId);
  assert.equal(a.repository, "acme/app");
  assert.notEqual(tenantIdFromBuyer({ buyerWallet: "0x1" }), tenantIdFromBuyer({ buyerWallet: "0x2" }));
});

test("support matrix does not claim universal languages", () => {
  assert.equal(REPOSITORY_SUPPORT_MATRIX.claims.universalLanguageSupport, false);
  assert.deepEqual(REPOSITORY_SUPPORT_MATRIX.supportedLanguages, ["JavaScript", "TypeScript"]);
  const unsupported = unsupportedRepositoryResponse("Primary project language is not currently supported");
  assert.equal(unsupported.status, "UNSUPPORTED");
  assert.equal(classifyPrimaryLanguage({ ".py": 40 }).supported, false);
  assert.equal(classifyPrimaryLanguage({ ".ts": 10, ".tsx": 5 }).supported, true);
});

test("public intake rejects non-GitHub and traversal", () => {
  assert.equal(validateGitHubRepositoryUrl("file:///tmp/repo").ok, false);
  assert.equal(validateGitHubRepositoryUrl("git@github.com:o/r.git").ok, false);
  assert.equal(validateGitHubRepositoryUrl("https://github.com/o/../evil").ok, false);
  const ok = validateGitHubRepositoryUrl("https://github.com/acme/widgets");
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.owner, "acme");
    assert.equal(ok.name, "widgets");
  }
});

test("marketplace intake has no repository allowlist payload", () => {
  const response = buildMarketplaceIntakeResponse("req_test");
  assert.equal(response.repositoryAllowlist, false);
  assert.equal(response.multiTenant, true);
  assert.equal("primaryProofRepositories" in response, false);
  assert.ok(response.supported.languages.includes("TypeScript"));
});

test("tenant route audit covers critical ID surfaces", () => {
  assert.ok(TENANT_ISOLATION_ROUTE_AUDIT.length >= 5);
  assert.ok(PRODUCTION_BYPASS_AUDIT.some((e) => e.pattern.includes("Meridian")));
  assert.ok(PUBLIC_CAPACITY_LIMITS.maxArchiveBytes >= 25 * 1024 * 1024);
});

console.log("public-multitenant: all passed");
