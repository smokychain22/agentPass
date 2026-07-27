/**
 * GitHub write-capability endpoint — the Create Cleanup PR connection gate.
 *
 * Regression context: the workbench previously asked
 * `/api/okx/intake/repository` whether GitHub was connected. That route
 * answers as the anonymous read-only tenant, so it could never observe a
 * GitHub App installation and always reported `canCreatePullRequest: false`
 * — the tab showed "Not connected" even after a successful install. It also
 * enqueued a deep-scan job as a side effect of every capability probe.
 *
 * These tests pin the replacement contract: connection is derived only from
 * an authoritative installation lookup, never from callback parameters, and
 * the probe has no side effects.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-gh-capability-"));
process.env.REPODIET_DATA_DIR = dataDir;

import { POST as capabilityPost } from "../src/app/api/github/capability/route";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

function req(body: unknown) {
  return new Request("http://localhost/api/github/capability", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function run() {
  console.log("github-capability-endpoint");

  await test("rejects a malformed body", async () => {
    const res = await capabilityPost(
      new Request("http://localhost/api/github/capability", { method: "POST", body: "not-json" })
    );
    assert.equal(res.status, 400);
    const json = (await res.json()) as { failureCode?: string };
    assert.equal(json.failureCode, "invalid_body");
  });

  await test("rejects a non-GitHub repository URL", async () => {
    const res = await capabilityPost(req({ repositoryUrl: "https://gitlab.com/a/b" }));
    assert.equal(res.status, 400);
    const json = (await res.json()) as { failureCode?: string };
    assert.equal(json.failureCode, "invalid_repository_url");
  });

  await test("a callback query parameter cannot spoof connection", async () => {
    // The endpoint accepts only repositoryUrl/installationId. Even supplying
    // connected-looking fields must not influence the verdict, which comes
    // solely from the authoritative installation lookup.
    const res = await capabilityPost(
      req({
        repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        github: "connected",
        connected: true,
        canCreatePullRequest: true,
        setup_action: "install",
      })
    );
    const json = (await res.json()) as { connected?: boolean; canCreatePullRequest?: boolean };
    // Without real GitHub App credentials configured in this test process,
    // the authoritative lookup cannot verify anything, so it must fail closed.
    assert.equal(json.connected, false);
    assert.equal(json.canCreatePullRequest, false);
  });

  await test("fails closed when the GitHub App cannot be verified", async () => {
    const res = await capabilityPost(
      req({ repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test" })
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      ok?: boolean;
      connected?: boolean;
      connectionState?: string;
      canCreateBranch?: boolean;
      canPushChanges?: boolean;
      canReadRepository?: boolean;
      failureCode?: string;
    };
    assert.equal(json.ok, true);
    assert.equal(json.connected, false);
    assert.equal(json.canCreateBranch, false);
    assert.equal(json.canPushChanges, false);
    assert.equal(json.canReadRepository, false);
    assert.notEqual(json.connectionState, "connected");
    assert.ok(json.failureCode, "an unverified result must carry a failureCode");
  });

  await test("every capability is reported, so the UI can explain the exact gap", async () => {
    const res = await capabilityPost(
      req({ repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test" })
    );
    const json = (await res.json()) as Record<string, unknown>;
    for (const field of [
      "connectionState",
      "installationFound",
      "repositorySelected",
      "repositoryFullName",
      "canReadRepository",
      "canCreateBranch",
      "canPushChanges",
      "canCreatePullRequest",
      "canReadChecks",
      "permissions",
      "missingPermissions",
      "verifiedAt",
    ]) {
      assert.ok(field in json, `missing capability field: ${field}`);
    }
  });

  await test("the probe never returns installation tokens or key material", async () => {
    const res = await capabilityPost(
      req({ repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test" })
    );
    const raw = JSON.stringify(await res.json()).toLowerCase();
    for (const secret of ["private_key", "privatekey", "ghs_", "client_secret", "webhook_secret"]) {
      assert.ok(!raw.includes(secret), `possible secret leaked: ${secret}`);
    }
  });

  await test("capability responses are never cached", async () => {
    const res = await capabilityPost(
      req({ repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test" })
    );
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  await test("the probe does not queue a deep scan (no deepScanJobId side effect)", async () => {
    const res = await capabilityPost(
      req({ repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test" })
    );
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.deepScanJobId, undefined);
    assert.equal(json.progressUrl, undefined);
    assert.equal(json.nextAction, undefined);
  });

  console.log("github-capability-endpoint: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
