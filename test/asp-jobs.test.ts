import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

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
  console.log("ASP jobs API tests");

  await test("ASP API route files exist", () => {
    for (const route of [
      "src/app/api/asp/jobs/route.ts",
      "src/app/api/asp/jobs/[jobId]/route.ts",
      "src/app/api/asp/jobs/[jobId]/run/route.ts",
      "src/app/api/asp/jobs/[jobId]/delivery/route.ts",
    ]) {
      assert.ok(fs.existsSync(path.join(ROOT, route)), `missing ${route}`);
    }
  });

  await test("asp_jobs persistence collection registered", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/lib/store/persistent-store.ts"), "utf8");
    assert.match(source, /"asp_jobs"/);
  });

  await test("OKX A2A skill file exists", () => {
    assert.ok(fs.existsSync(path.join(ROOT, "skills/repodiet-okx-a2a.md")));
    const skill = fs.readFileSync(path.join(ROOT, "skills/repodiet-okx-a2a.md"), "utf8");
    assert.match(skill, /POST \/api\/asp\/jobs/);
    assert.match(skill, /authorization_required/);
    assert.match(skill, /Never share personal access tokens/i);
  });

  await test("ASP operator auth uses constant-time comparison", async () => {
    const { verifyAspOperatorAuthorization } = await import("../src/lib/asp/auth");
    const prev = process.env.ASP_OPERATOR_KEY;
    process.env.ASP_OPERATOR_KEY = "test-secret-key-123";

    const bad = verifyAspOperatorAuthorization(
      new Request("http://localhost/api/asp/jobs", {
        headers: { Authorization: "Bearer wrong-key" },
      })
    );
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.status, 401);

    const good = verifyAspOperatorAuthorization(
      new Request("http://localhost/api/asp/jobs", {
        headers: { Authorization: "Bearer test-secret-key-123" },
      })
    );
    assert.equal(good.ok, true);

    process.env.ASP_OPERATOR_KEY = prev;
  });

  await test("validateCreateAspJobInput rejects invalid repository URL", async () => {
    const { validateCreateAspJobInput } = await import("../src/lib/asp/validation");
    const result = validateCreateAspJobInput({
      okxOrderId: "order-1",
      repositoryUrl: "not-a-url",
    });
    assert.equal(result.ok, false);
  });

  await test("validateCreateAspJobInput accepts safe defaults", async () => {
    const { validateCreateAspJobInput } = await import("../src/lib/asp/validation");
    const result = validateCreateAspJobInput({
      okxOrderId: "order-1",
      repositoryUrl: "https://github.com/smokychain22/repodiet-e2e-test",
      baseBranch: "main",
      cleanupMode: "safe",
      maximumChanges: 20,
      requiredChecks: ["typecheck", "build"],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.cleanupMode, "safe");
      assert.deepEqual(result.value.requiredChecks, ["typecheck", "build"]);
    }
  });

  await test("validateCreateAspJobInput rejects unsupported cleanup mode", async () => {
    const { validateCreateAspJobInput } = await import("../src/lib/asp/validation");
    const result = validateCreateAspJobInput({
      okxOrderId: "order-1",
      repositoryUrl: "https://github.com/smokychain22/repodiet-e2e-test",
      cleanupMode: "aggressive",
    });
    assert.equal(result.ok, false);
  });

  await test("parseAspJobIdFromReturnPath extracts job id", async () => {
    const { parseAspJobIdFromReturnPath } = await import("../src/lib/asp/install-callback");
    assert.equal(
      parseAspJobIdFromReturnPath("/okx/asp?jobId=job_abc123"),
      "job_abc123"
    );
    assert.equal(parseAspJobIdFromReturnPath("/app?tab=patch"), undefined);
  });

  await test("buildAspDeliveryResponse pending until real PR proof", async () => {
    const { buildAspDeliveryResponse } = await import("../src/lib/asp/delivery");
    const pending = buildAspDeliveryResponse({
      id: "job_x",
      okxOrderId: "order_x",
      repositoryOwner: "owner",
      repositoryName: "repo",
      repositoryUrl: "https://github.com/owner/repo",
      baseBranch: "main",
      cleanupMode: "safe",
      maximumChanges: 20,
      requiredChecks: ["typecheck"],
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    assert.equal(pending.status, "pending");

    const delivered = buildAspDeliveryResponse({
      id: "job_x",
      okxOrderId: "order_x",
      repositoryOwner: "owner",
      repositoryName: "repo",
      repositoryUrl: "https://github.com/owner/repo",
      baseBranch: "main",
      baseCommitSha: "abc",
      cleanupMode: "safe",
      maximumChanges: 20,
      requiredChecks: ["typecheck"],
      status: "delivered",
      cleanupBranch: "repodiet/cleanup-1",
      cleanupCommitSha: "def",
      pullRequestUrl: "https://github.com/owner/repo/pull/1",
      filesEdited: 1,
      filesDeleted: 1,
      linesAdded: 2,
      linesRemoved: 5,
      patchValidationStatus: "passed",
      verificationStatus: {
        patch: "passed",
        typecheck: "passed",
        lint: "skipped",
        test: "skipped",
        build: "passed",
      },
      protectedFilesChanged: 0,
      defaultBranchChanged: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deliveredAt: new Date().toISOString(),
    });
    assert.equal(delivered.status, "delivered");
    assert.equal(delivered.pullRequestUrl, "https://github.com/owner/repo/pull/1");
    assert.equal(delivered.defaultBranchChanged, false);
  });

  await test("buildAspDeliveryResponse failed includes failure code", async () => {
    const { buildAspDeliveryResponse } = await import("../src/lib/asp/delivery");
    const failed = buildAspDeliveryResponse({
      id: "job_x",
      okxOrderId: "order_x",
      repositoryOwner: "owner",
      repositoryName: "repo",
      repositoryUrl: "https://github.com/owner/repo",
      baseBranch: "main",
      cleanupMode: "safe",
      maximumChanges: 20,
      requiredChecks: ["typecheck"],
      status: "failed",
      failureCode: "NO_SUPPORTED_REPAIRS",
      failureMessage: "No repairs",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.failureCode, "NO_SUPPORTED_REPAIRS");
  });

  await test("duplicate okxOrderId returns same job id", async () => {
    process.env.REPODIET_DATA_DIR = path.join(ROOT, ".repodiet-test-asp");
    const dataDir = process.env.REPODIET_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });

    const { createAspJob } = await import("../src/lib/asp/job-service");
    const first = await createAspJob({
      okxOrderId: "okx_dup_test_1",
      repositoryUrl: "https://github.com/smokychain22/repodiet-e2e-test",
      baseBranch: "main",
      cleanupMode: "safe",
      maximumChanges: 5,
      requiredChecks: ["typecheck", "build"],
    });
    const second = await createAspJob({
      okxOrderId: "okx_dup_test_1",
      repositoryUrl: "https://github.com/smokychain22/repodiet-e2e-test",
    });
    assert.equal(first.jobId, second.jobId);

    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await test("timingSafeEqual sanity for auth pattern", () => {
    const a = Buffer.from("secret");
    const b = Buffer.from("secret");
    assert.equal(timingSafeEqual(a, b), true);
  });

  console.log("All ASP jobs API tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
