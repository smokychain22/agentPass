import assert from "node:assert/strict";
import {
  PREVIEW_DRY_RUN_CODE,
  assertPreviewAllowsCleanupDispatch,
  assertPreviewAllowsPayment,
  assertPreviewAllowsRepositoryWrite,
  buildPreviewDryRunDenial,
  getDeploymentEnvironment,
  isPreviewDryRun,
  isPreviewPaymentBlocked,
  isPreviewRepositoryWriteBlocked,
  PreviewDryRunError,
} from "../src/lib/deployment/preview-dry-run";
import { evaluateControlledDeliverySelection } from "../src/lib/cleanup/controlled-delivery-scope";
import { exactChargeLabelFromMicro } from "../src/lib/pricing/exact-amount";
import { signExecutionReceipt, type ExecutionReceipt } from "../src/lib/operator/sign-receipt";
import {
  buildInitialTask,
  getA2ATask,
  saveA2ATask,
} from "../src/lib/a2a/task-store";
import {
  fundA2ATask,
  rejectUnsafeSelectionA2ATask,
} from "../src/lib/a2a/orchestrator";
import { GitHubClient } from "../src/lib/github/github-client";

const originalEnv = { ...process.env };

async function withEnv(
  patch: Record<string, string | undefined>,
  fn: () => void | Promise<void>
) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  }
}

async function run(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

async function main() {
  console.log("preview-dry-run");

  await run("preview environment blocks payment and writes", async () => {
    await withEnv({ VERCEL_ENV: "preview", NODE_ENV: "production" }, () => {
      assert.equal(getDeploymentEnvironment(), "preview");
      assert.equal(isPreviewDryRun(), true);
      assert.equal(isPreviewPaymentBlocked(), true);
      assert.equal(isPreviewRepositoryWriteBlocked(), true);
      const denial = buildPreviewDryRunDenial();
      assert.equal(denial.code, PREVIEW_DRY_RUN_CODE);
      assert.equal(denial.paymentAllowed, false);
      assert.equal(denial.repositoryWriteAllowed, false);
      assert.throws(() => assertPreviewAllowsPayment(), PreviewDryRunError);
      assert.throws(() => assertPreviewAllowsRepositoryWrite(), PreviewDryRunError);
      assert.throws(() => assertPreviewAllowsCleanupDispatch(), PreviewDryRunError);
    });
  });

  await run("production allows payment and writes", async () => {
    await withEnv(
      {
        VERCEL_ENV: "production",
        REPODIET_PREVIEW_ALLOW_LIVE_PAYMENT: undefined,
        REPODIET_PREVIEW_ALLOW_REPO_WRITE: undefined,
      },
      () => {
        assert.equal(isPreviewPaymentBlocked(), false);
        assert.equal(isPreviewRepositoryWriteBlocked(), false);
        assert.doesNotThrow(() => assertPreviewAllowsPayment());
        assert.doesNotThrow(() => assertPreviewAllowsRepositoryWrite());
      }
    );
  });

  await run("GitHubClient mutations refuse outside production", async () => {
    await withEnv({ VERCEL_ENV: "preview" }, async () => {
      const client = new GitHubClient("ghs_test_token_not_used");
      await assert.rejects(
        () => client.createBranch("o", "r", "repodiet/cleanup-x", "abc"),
        (err: unknown) =>
          err instanceof Error && err.message.includes(PREVIEW_DRY_RUN_CODE)
      );
      await assert.rejects(
        () => client.createPullRequest("o", "r", "t", "h", "b", "body"),
        (err: unknown) =>
          err instanceof Error && err.message.includes(PREVIEW_DRY_RUN_CODE)
      );
    });
  });

  await run("preview receipts are simulated and unsigned", async () => {
    await withEnv(
      { VERCEL_ENV: "preview", REPODIET_OPERATOR_PRIVATE_KEY: "should-not-be-used" },
      () => {
        const receipt: ExecutionReceipt = {
          taskId: "task_preview",
          repository: "o/r",
          commitSha: "abc",
          findingIds: ["f1"],
          patchHash: "sha256:patch",
          verificationHash: "sha256:verify",
          status: "verified",
          timestamp: new Date().toISOString(),
          pullRequestUrl: "https://example.com/pr/1",
        };
        const signed = signExecutionReceipt(receipt);
        assert.equal(signed.signature, null);
        assert.equal(signed.signedBy, "preview-dry-run");
        assert.match(signed.receipt.patchHash, /^simulated-preview:/);
        assert.equal(signed.receipt.status, "failed");
        assert.equal(signed.signedReceipt.operator, "preview-dry-run");
      }
    );
  });

  await run("production hard-rejects runtime/config paths", () => {
    const gate = evaluateControlledDeliverySelection(["src/config/runtime-hook.ts"]);
    assert.equal(gate.allowed, false);
    assert.match(gate.message ?? "", /runtime\/config hook/);
  });

  await run("exact payable amount is unambiguous", () => {
    assert.equal(exactChargeLabelFromMicro("1000000"), "1.00 USDT");
    assert.doesNotMatch(exactChargeLabelFromMicro("1000000"), /negotiated/i);
  });

  await run("reject unsafe selection is terminal and not reusable", async () => {
    const task = buildInitialTask(
      "repository.cleanup_pr",
      {
        repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        branch: "main",
        commitSha: "c0838e4cda326098a363b44e0e3ebe98e81e9463",
        findingIds: ["fnd_wdEvC5-7mr"],
        quoteId: "quote_reject_test_1",
        purchaseChannel: "direct_site",
      },
      {
        owner: "velz-cmd",
        name: "repodiet-e2e-test",
        branch: "main",
        commitSha: "c0838e4cda326098a363b44e0e3ebe98e81e9463",
        url: "https://github.com/velz-cmd/repodiet-e2e-test",
      }
    );
    task.status = "awaiting_payment";
    task.transitions.push({
      status: "awaiting_payment",
      at: new Date().toISOString(),
      role: "orchestrator",
      detail: "quote_reject_test_1",
    });
    await saveA2ATask(task);

    const rejected = await rejectUnsafeSelectionA2ATask(
      task.id,
      "src/config/runtime-hook.ts is a runtime/config hook"
    );
    assert.equal(rejected.status, "rejected");
    assert.match(rejected.error ?? "", /REJECTED_UNSAFE_SELECTION/);
    assert.equal(rejected.input.findingIds?.[0], "fnd_wdEvC5-7mr");
    assert.ok(rejected.transitions.some((t) => t.status === "rejected"));

    await assert.rejects(
      () =>
        fundA2ATask(task.id, {
          quoteId: "quote_reject_test_1",
          paymentReference: "0xdead",
          payer: "0x1111111111111111111111111111111111111111",
        }),
      (err: unknown) =>
        err instanceof Error && /not awaiting payment|already terminal|rejected/i.test(err.message)
    );

    const again = await getA2ATask(task.id);
    assert.equal(again?.status, "rejected");
    assert.deepEqual(again?.input.findingIds, ["fnd_wdEvC5-7mr"]);
  });

  await run("new safe selection uses a new task id", () => {
    const a = buildInitialTask(
      "repository.cleanup_pr",
      {
        repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        branch: "main",
        commitSha: "c0838e4cda326098a363b44e0e3ebe98e81e9463",
        findingIds: ["fnd_empty"],
        purchaseChannel: "direct_site",
      },
      {
        owner: "velz-cmd",
        name: "repodiet-e2e-test",
        branch: "main",
        url: "https://github.com/velz-cmd/repodiet-e2e-test",
      }
    );
    const b = buildInitialTask(
      "repository.cleanup_pr",
      {
        repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        branch: "main",
        commitSha: "c0838e4cda326098a363b44e0e3ebe98e81e9463",
        findingIds: ["fnd_confirmed"],
        purchaseChannel: "direct_site",
      },
      {
        owner: "velz-cmd",
        name: "repodiet-e2e-test",
        branch: "main",
        url: "https://github.com/velz-cmd/repodiet-e2e-test",
      }
    );
    assert.notEqual(a.id, b.id);
    assert.notDeepEqual(a.input.findingIds, b.input.findingIds);
  });

  await run("pay route preview denial contract", async () => {
    await withEnv({ VERCEL_ENV: "preview" }, () => {
      const denial = buildPreviewDryRunDenial();
      assert.equal(denial.code, "PREVIEW_DRY_RUN_ONLY");
      assert.equal(denial.environment, "preview");
      assert.equal(exactChargeLabelFromMicro("1000000"), "1.00 USDT");
    });
  });

  console.log("preview-dry-run: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
