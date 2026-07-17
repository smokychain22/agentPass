import assert from "node:assert/strict";
import { resolveTenantIdentity } from "../src/lib/tenant/request-auth";
import { analysisError } from "../src/lib/findings/analysis-errors";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("findings-tenant-binding");

test("no session and no buyer → anonymous", () => {
  const identity = resolveTenantIdentity(new Request("https://example.com/api/findings/analyze"));
  assert.equal(identity.source, "anonymous");
  assert.equal(identity.tenantId, "anonymous_public_readonly");
});

test("browser session cookie binds tenant", () => {
  const identity = resolveTenantIdentity(
    new Request("https://example.com/api/findings/analyze", {
      headers: { cookie: "repodiet_browser_session=abc123session" },
    })
  );
  assert.equal(identity.source, "session");
  assert.equal(identity.tenantId, "browser:abc123session");
});

test("free-form x-repodiet-tenant-id is not ownership", () => {
  const identity = resolveTenantIdentity(
    new Request("https://example.com/api/findings/analyze", {
      headers: { "x-repodiet-tenant-id": "okx_attacker" },
    })
  );
  assert.notEqual(identity.tenantId, "okx_attacker");
  assert.equal(identity.source, "anonymous");
});

test("commit mismatch contract is 409-shaped", () => {
  const err = analysisError({
    code: "SOURCE_COMMIT_MISMATCH",
    message: "Requested source commit does not match the structure scan pin.",
    retryable: false,
    requestId: "req_x",
    structureScanId: "scan_x",
    requiredAction: "RESCAN_REPOSITORY",
  });
  assert.equal(err.code, "SOURCE_COMMIT_MISMATCH");
  assert.equal(err.retryable, false);
});

test("repository mismatch contract is distinct", () => {
  const err = analysisError({
    code: "SCAN_REPOSITORY_MISMATCH",
    message: "Repository does not match the structure scan.",
    retryable: false,
    requestId: "req_y",
    requiredAction: "USE_MATCHING_SCAN",
  });
  assert.equal(err.code, "SCAN_REPOSITORY_MISMATCH");
});

console.log("findings-tenant-binding: all passed");
