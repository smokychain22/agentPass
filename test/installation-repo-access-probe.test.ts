/**
 * Incident #39, Row 8 139a6ad: `probeRepositoryWithInstallationToken` used to
 * treat a successful `GET /repos/{owner}/{repo}` as proof of installation
 * access. That read succeeds for ANY valid token on a PUBLIC repository
 * regardless of real grant, so it falsely "verified" an unrelated
 * installation against velz-cmd/repodiet-e2e-test, which then failed for
 * real at branch creation 70 minutes into a production run. The probe now
 * also checks the installation's own `/installation/repositories` list,
 * which cannot be spoofed by a target repo's visibility.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { probeRepositoryWithInstallationToken } from "../src/lib/github-app/installations";

// createInstallationAccessToken signs a real App JWT before ever reaching
// the network. The real key lives only on the deployed box, so a throwaway
// keypair stands in here — it only needs to satisfy jsonwebtoken's RS256
// signer, since every actual HTTP call in these tests is mocked.
if (!process.env.GITHUB_APP_ID) {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  process.env.GITHUB_APP_ID = "999999";
  process.env.GITHUB_APP_CLIENT_ID = "test-client-id";
  process.env.GITHUB_APP_CLIENT_SECRET = "test-client-secret";
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
  process.env.GITHUB_APP_SLUG = "repodiet-test";
}

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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

console.log("installation-repo-access-probe");

async function main() {
  await test("returns false for a public repo the installation does not actually grant, even though its content read succeeds", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/access_tokens")) {
        return jsonResponse(201, { token: "ghs_fake", expires_at: "2026-01-01T00:00:00Z" });
      }
      if (url.includes("/repos/velz-cmd/repodiet-e2e-test")) {
        // Public-repo read succeeds regardless of real installation grant.
        return jsonResponse(200, { default_branch: "main" });
      }
      if (url.includes("/installation/repositories")) {
        // This installation's real grant does NOT include the target repo.
        return jsonResponse(200, { repositories: [{ full_name: "smokychain22/agentPass" }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const result = await probeRepositoryWithInstallationToken(146959843, "velz-cmd", "repodiet-e2e-test");
      assert.equal(result, false, "a public-repo read succeeding must not be treated as real access");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await test("returns true when the installation's own repository list actually includes the target repo", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/access_tokens")) {
        return jsonResponse(201, { token: "ghs_fake", expires_at: "2026-01-01T00:00:00Z" });
      }
      if (url.includes("/repos/velz-cmd/repodiet-e2e-test")) {
        return jsonResponse(200, { default_branch: "main" });
      }
      if (url.includes("/installation/repositories")) {
        return jsonResponse(200, { repositories: [{ full_name: "velz-cmd/repodiet-e2e-test" }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const result = await probeRepositoryWithInstallationToken(145764323, "velz-cmd", "repodiet-e2e-test");
      assert.equal(result, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await test("returns false when the content read itself fails (no token / no access at all)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/access_tokens")) {
        return jsonResponse(201, { token: "ghs_fake", expires_at: "2026-01-01T00:00:00Z" });
      }
      if (url.includes("/repos/")) {
        return jsonResponse(404, { message: "Not Found" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const result = await probeRepositoryWithInstallationToken(1, "someone", "private-repo");
      assert.equal(result, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

main()
  .then(() => console.log("installation-repo-access-probe: all passed"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
