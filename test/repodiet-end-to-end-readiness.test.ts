import assert from "node:assert/strict";
import {
  buildX402ChallengeFrom402Body,
  decodePaymentRequiredHeader,
  encodePaymentRequiredHeader,
  paymentRequiredJsonResponse,
} from "../src/lib/payment/x402-payment-required";
import { paymentRequiredBody } from "../src/lib/payment/x402";
import {
  MAINNET_NETWORK,
  MAINNET_USDT,
  TESTNET_NETWORK,
  TESTNET_USDT,
  assertProductionPaymentConfig,
  getPaymentEnvironment,
} from "../src/lib/payment/payment-environment";
import {
  normalizePublicGitHubRepositoryUrl,
  preflightA2mcpQuickTriage,
} from "../src/lib/a2mcp/a2mcp-preflight";
import {
  claimPaymentExecution,
  getPaymentExecutionByPaymentId,
} from "../src/lib/payment/payment-execution-store";
import { canTransition, A2ATaskStateMachine } from "../src/lib/a2a/task-state-machine";
import { reconcileParentTaskFromScan } from "../src/lib/a2a/reconcile-parent-from-scan";
import { saveA2ATask, buildInitialTask } from "../src/lib/a2a/task-store";
import { setPersistentRecord } from "../src/lib/store/persistent-store";
import type { DeepScanJob } from "../src/lib/deep-scan/types";
import {
  assertNoSecretKeys,
  toPublicDeepScanDto,
} from "../src/lib/deep-scan/public-dto";
import { X402_ASSET, X402_NETWORK, X402_RECIPIENT } from "../src/lib/payment/constants";

// Re-export aliases used below — payment-environment exports MAINNET_USDT as asset constant.
const MAINNET_ASSET_ADDR = MAINNET_USDT;

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

console.log("repodiet-end-to-end-readiness");

async function main() {
  await test("PAYMENT-REQUIRED canonical accepts[] — no top-level payment fields", async () => {
    const body = paymentRequiredBody(
      "https://skillswap-virid-kappa.vercel.app/api/a2mcp/quick-triage",
      "30000",
      "quote_e2e"
    );
    const challenge = buildX402ChallengeFrom402Body(body);
    assert.equal(challenge.x402Version, 2);
    assert.ok(challenge.resource.url);
    assert.ok(challenge.accepts.length >= 1);
    assert.equal(challenge.accepts[0].amount, "30000");
    assert.equal(challenge.accepts[0].payTo, X402_RECIPIENT);
    const flat = challenge as unknown as Record<string, unknown>;
    assert.equal(flat.scheme, undefined);
    assert.equal(flat.network, undefined);
    assert.equal(flat.asset, undefined);
    assert.equal(flat.amount, undefined);
    assert.equal(flat.payTo, undefined);

    const res = paymentRequiredJsonResponse({ success: false, ...body });
    const header = res.headers.get("PAYMENT-REQUIRED");
    assert.ok(header);
    const decoded = decodePaymentRequiredHeader(header!);
    assert.deepEqual(decoded.accepts, challenge.accepts);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  });

  await test("testnet and production config cannot mix", () => {
    const pe = getPaymentEnvironment({
      REPODIET_PAYMENT_ENV: "testnet",
      REPODIET_PAYMENT_NETWORK: TESTNET_NETWORK,
      REPODIET_PAYMENT_ASSET: TESTNET_USDT,
      REPODIET_PAYMENT_CHAIN_ID: "1952",
      OKX_AGENTIC_WALLET_ADDRESS: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(pe.paymentMode, "testnet");
    assert.equal(pe.network, TESTNET_NETWORK);
    assert.equal(pe.asset, TESTNET_USDT);
    assert.equal(pe.mainnetBlocked, false);

    const mixed = getPaymentEnvironment({
      REPODIET_PAYMENT_ENV: "testnet",
      REPODIET_PAYMENT_NETWORK: MAINNET_NETWORK,
      REPODIET_PAYMENT_ASSET: MAINNET_ASSET_ADDR,
      REPODIET_PAYMENT_CHAIN_ID: "196",
      OKX_AGENTIC_WALLET_ADDRESS: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(mixed.mainnetBlocked, true);
  });

  await test("missing production configuration fails closed", () => {
    assert.throws(
      () =>
        assertProductionPaymentConfig({
          REPODIET_PAYMENT_ENV: "production",
          REPODIET_PAYMENT_NETWORK: MAINNET_NETWORK,
          REPODIET_PAYMENT_ASSET: MAINNET_ASSET_ADDR,
          // payee intentionally missing / invalid
          OKX_AGENTIC_WALLET_ADDRESS: "",
          PAY_TO_ADDRESS: "",
          REPODIET_PAY_TO: "",
        } as unknown as NodeJS.ProcessEnv),
      /PRODUCTION_PAYMENT/
    );
  });

  await test("production readiness constants without funds", () => {
    const pe = getPaymentEnvironment({
      REPODIET_PAYMENT_ENV: "production",
      REPODIET_PAYMENT_NETWORK: MAINNET_NETWORK,
      REPODIET_PAYMENT_ASSET: MAINNET_ASSET_ADDR,
      REPODIET_PAYMENT_CHAIN_ID: "196",
      OKX_AGENTIC_WALLET_ADDRESS: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(pe.network, "eip155:196");
    assert.equal(pe.asset, "0x779ded0c9e1022225f8e0630b35a9b54be713736");
    assert.equal(pe.chainId, 196);
    // No transaction sent — constants check only.
  });

  await test("SSRF and invalid repository preflight returns 4xx before 402", async () => {
    const blocked = normalizePublicGitHubRepositoryUrl("https://127.0.0.1/owner/repo");
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "SSRF_BLOCKED");

    const badHost = normalizePublicGitHubRepositoryUrl("https://evil.example/owner/repo");
    assert.equal(badHost.ok, false);

    const missing = await preflightA2mcpQuickTriage(
      { repositoryUrl: "", operation: "analyze_repository" },
      { resolveCommit: false }
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.status, 400);
      assert.ok(missing.status < 402);
    }

    const wrongOp = await preflightA2mcpQuickTriage(
      {
        repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        operation: "delete_everything",
      },
      { resolveCommit: false }
    );
    assert.equal(wrongOp.ok, false);
  });

  await test("payment idempotency and different request hash rejection", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "";
    process.env.UPSTASH_REDIS_REST_TOKEN = "";
    const paymentId = `pay_test_${Date.now()}`;
    const first = await claimPaymentExecution({
      requestHash: "sha256:aaa",
      normalizedRepository: "velz-cmd/repodiet-e2e-test",
      commitSha: "abc123",
      paymentMethod: "exact",
      network: X402_NETWORK,
      asset: X402_ASSET,
      amount: "30000",
      payer: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
      payee: X402_RECIPIENT,
      paymentId,
    });
    assert.equal(first.created, true);
    const replay = await claimPaymentExecution({
      requestHash: "sha256:aaa",
      normalizedRepository: "velz-cmd/repodiet-e2e-test",
      commitSha: "abc123",
      paymentMethod: "exact",
      network: X402_NETWORK,
      asset: X402_ASSET,
      amount: "30000",
      payer: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
      payee: X402_RECIPIENT,
      paymentId,
    });
    assert.equal(replay.created, false);
    assert.equal(replay.record.executionId, first.record.executionId);

    await assert.rejects(
      () =>
        claimPaymentExecution({
          requestHash: "sha256:DIFFERENT",
          normalizedRepository: "velz-cmd/repodiet-e2e-test",
          commitSha: "abc123",
          paymentMethod: "exact",
          network: X402_NETWORK,
          asset: X402_ASSET,
          amount: "30000",
          payer: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
          payee: X402_RECIPIENT,
          paymentId,
        }),
      /PAYMENT_PROOF_REQUEST_MISMATCH/
    );

    const loaded = await getPaymentExecutionByPaymentId(paymentId);
    assert.ok(loaded);
    assert.equal(loaded!.requestHash, "sha256:aaa");
  });

  await test("A2A state machine valid and invalid transitions", () => {
    assert.equal(canTransition("fetching_repository", "analyzing"), true);
    assert.equal(canTransition("fetching_repository", "completed"), false);
    const sm = new A2ATaskStateMachine(undefined, { strict: true });
    sm.emit("queued", "orchestrator");
    sm.emit("fetching_repository", "repository_analyzer");
    assert.throws(() => sm.emit("completed", "orchestrator"), /invalid_a2a_transition/);
    // Recovery path allowed with reconcile detail.
    sm.emit("analysis_failed", "repository_analyzer", "reconcile: child failed");
    assert.equal(sm.current(), "analysis_failed");
  });

  await test("child READY advances parent exactly once (historical bug)", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "";
    process.env.UPSTASH_REDIS_REST_TOKEN = "";
    const task = buildInitialTask(
      "repository.safe_cleanup",
      {
        repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        branch: "main",
      },
      {
        owner: "velz-cmd",
        name: "repodiet-e2e-test",
        branch: "main",
        url: "https://github.com/velz-cmd/repodiet-e2e-test",
      }
    );
    // Simulate historical stuck state.
    task.status = "fetching_repository";
    task.transitions = [
      { status: "submitted", at: new Date().toISOString(), role: "orchestrator" },
      { status: "queued", at: new Date().toISOString(), role: "orchestrator" },
      {
        status: "fetching_repository",
        at: new Date().toISOString(),
        role: "repository_analyzer",
      },
    ];
    task.result = {
      deepScanJobId: "deep_scan_mBRWlwmRcQAM",
      queueJobId: "deep_scan_mBRWlwmRcQAM",
      dispatchState: "DISPATCHED",
      stateVersion: task.transitions.length,
    };
    await saveA2ATask(task);

    const now = new Date().toISOString();
    const scan: DeepScanJob = {
      id: "deep_scan_mBRWlwmRcQAM",
      status: "complete",
      stage: "READY",
      progress: { stage: "READY", percent: 100, updatedAt: now },
      request: {
        repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        branch: "main",
        a2aTaskId: task.id,
        tenantId: `a2a:${task.id}`,
      },
      tenantId: `a2a:${task.id}`,
      repositoryOwner: "velz-cmd",
      repositoryName: "repodiet-e2e-test",
      repositoryFullName: "velz-cmd/repodiet-e2e-test",
      branch: "main",
      findingsId: "findings_hist_1",
      scanId: "findings_hist_1",
      attemptCount: 1,
      statusHistory: [{ stage: "READY", at: now }],
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      workerMode: "github_actions_on_demand",
      resultSummary: {
        dispatch: { dispatchState: "COMPLETED", dispatchAttempt: 1 },
      },
    };
    await setPersistentRecord("deep_scan_jobs", scan.id, scan);

    const first = await reconcileParentTaskFromScan(task.id, scan.id, {
      actor: "ingest_callback",
    });
    assert.ok(first);
    assert.equal(first!.advanced, true);
    assert.notEqual(first!.newStatus, "fetching_repository");
    assert.equal(first!.task.result.dispatchState, "COMPLETED");
    assert.ok(first!.newStatus === "quote_required" || first!.newStatus === "analyzing" || first!.newStatus === "awaiting_approval" || first!.newStatus === "delivery_ready");

    const second = await reconcileParentTaskFromScan(task.id, scan.id, {
      actor: "status_poll",
    });
    assert.ok(second);
    assert.equal(second!.advanced, false);
    assert.equal(second!.alreadyAdvanced, true);
    assert.equal(second!.newStatus, first!.newStatus);
  });

  await test("child failure moves parent out of DISPATCHED", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "";
    process.env.UPSTASH_REDIS_REST_TOKEN = "";
    const task = buildInitialTask(
      "repository.safe_cleanup",
      { repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test", branch: "main" },
      {
        owner: "velz-cmd",
        name: "repodiet-e2e-test",
        branch: "main",
        url: "https://github.com/velz-cmd/repodiet-e2e-test",
      }
    );
    task.status = "fetching_repository";
    task.transitions.push({
      status: "fetching_repository",
      at: new Date().toISOString(),
      role: "repository_analyzer",
    });
    task.result = {
      deepScanJobId: "deep_scan_fail_1",
      dispatchState: "DISPATCHED",
      stateVersion: task.transitions.length,
    };
    await saveA2ATask(task);
    const now = new Date().toISOString();
    await setPersistentRecord("deep_scan_jobs", "deep_scan_fail_1", {
      id: "deep_scan_fail_1",
      status: "failed",
      stage: "FAILED_TERMINAL",
      progress: { stage: "FAILED_TERMINAL", percent: 100, updatedAt: now },
      request: {
        repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        branch: "main",
        a2aTaskId: task.id,
      },
      repositoryOwner: "velz-cmd",
      repositoryName: "repodiet-e2e-test",
      repositoryFullName: "velz-cmd/repodiet-e2e-test",
      attemptCount: 1,
      statusHistory: [],
      createdAt: now,
      updatedAt: now,
      failureMessage: "worker timeout",
      workerMode: "github_actions_on_demand",
    } satisfies DeepScanJob);

    const result = await reconcileParentTaskFromScan(task.id, "deep_scan_fail_1");
    assert.ok(result?.advanced);
    assert.equal(result!.newStatus, "analysis_failed");
    assert.notEqual(result!.task.result.dispatchState, "DISPATCHED");
  });

  await test("public deep-scan DTO never exposes secret keys", () => {
    const now = new Date().toISOString();
    const job = {
      id: "deep_scan_public_1",
      status: "running",
      stage: "DISPATCHED",
      progress: { stage: "DISPATCHED", percent: 10, updatedAt: now },
      request: {
        repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        branch: "main",
        a2aTaskId: "task_public_1",
      },
      repositoryOwner: "velz-cmd",
      repositoryName: "repodiet-e2e-test",
      repositoryFullName: "velz-cmd/repodiet-e2e-test",
      attemptCount: 1,
      statusHistory: [],
      createdAt: now,
      updatedAt: now,
      dispatchNonce: "SECRET_DISPATCH_TOKEN_VALUE",
      claimToken: "SECRET_CLAIM",
      leaseExpiresAt: now,
      resultSummary: {
        dispatch: {
          dispatchState: "DISPATCHED",
          dispatchAttempt: 1,
          dispatchToken: "SECRET_DISPATCH_TOKEN_VALUE",
        },
      },
      workerMode: "github_actions_on_demand",
    } as DeepScanJob;

    const dto = toPublicDeepScanDto(job);
    const hits = assertNoSecretKeys(dto);
    assert.deepEqual(hits, [], `secret keys leaked: ${hits.join(", ")}`);
    const json = JSON.stringify(dto);
    assert.equal(json.includes("SECRET_DISPATCH_TOKEN_VALUE"), false);
    assert.equal(json.includes("SECRET_CLAIM"), false);
  });

  await test("header encode/decode round-trip preserves all accepts", () => {
    const body = {
      ...paymentRequiredBody("https://example.com/api/a2mcp/quick-triage", "30000"),
      accepts: [
        {
          scheme: "exact",
          network: MAINNET_NETWORK,
          asset: MAINNET_ASSET_ADDR,
          amount: "30000",
          payTo: X402_RECIPIENT,
          maxTimeoutSeconds: 300,
          extra: { name: "USDΓé«0", version: "1" },
        },
        {
          scheme: "exact",
          network: TESTNET_NETWORK,
          asset: TESTNET_USDT,
          amount: "30000",
          payTo: X402_RECIPIENT,
          maxTimeoutSeconds: 300,
          extra: { name: "USDΓé«0", version: "1" },
        },
      ],
    };
    const challenge = buildX402ChallengeFrom402Body(body);
    assert.equal(challenge.accepts.length, 2);
    const encoded = encodePaymentRequiredHeader(challenge);
    const decoded = decodePaymentRequiredHeader(encoded);
    assert.equal(decoded.accepts.length, 2);
  });

  console.log("\nAll end-to-end readiness unit checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
