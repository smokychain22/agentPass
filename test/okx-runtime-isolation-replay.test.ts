import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DurableEventStore } from "../src/lib/okx-runtime/event-store";
import {
  buildIsolatedRuntimeEnv,
  ensureRuntimeLayout,
  getRuntimePaths,
  OKX_RUNTIME_IDENTITIES,
} from "../src/lib/okx-runtime/runtime-layout";

function run() {
  console.log("okx-runtime-isolation-replay");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-runtimes-"));
  const buyer = getRuntimePaths(root, "buyer");
  const seller = getRuntimePaths(root, "seller");
  ensureRuntimeLayout(buyer);
  ensureRuntimeLayout(seller);
  assert.notEqual(buyer.home, seller.home);
  assert.notEqual(buyer.eventStore, seller.eventStore);
  assert.notEqual(buyer.pidFile, seller.pidFile);

  const buyerEnv = buildIsolatedRuntimeEnv(process.env, buyer, OKX_RUNTIME_IDENTITIES.buyer);
  const sellerEnv = buildIsolatedRuntimeEnv(process.env, seller, OKX_RUNTIME_IDENTITIES.seller);
  assert.equal(buyerEnv.REPODIET_OKX_AGENT_ID, "5295");
  assert.equal(sellerEnv.REPODIET_OKX_AGENT_ID, "9636");
  assert.notEqual(buyerEnv.HOME, sellerEnv.HOME);
  assert.notEqual(buyerEnv.ONCHAINOS_HOME, sellerEnv.ONCHAINOS_HOME);
  assert.notEqual(buyerEnv.OKX_AGENT_TASK_HOME, sellerEnv.OKX_AGENT_TASK_HOME);
  assert.equal(
    sellerEnv.OKX_AGENT_TASK_HOME,
    path.join(seller.home, ".okx-agent-task")
  );

  const sellerStore = new DurableEventStore(
    seller.eventStore,
    OKX_RUNTIME_IDENTITIES.seller.agentId,
    OKX_RUNTIME_IDENTITIES.seller.walletAddress
  );
  sellerStore.begin({ eventId: "event-a", semanticKey: "job-a:created", jobId: "job-a" });
  sellerStore.acknowledge("event-a", "cursor-42");

  const afterRestart = new DurableEventStore(
    seller.eventStore,
    OKX_RUNTIME_IDENTITIES.seller.agentId,
    OKX_RUNTIME_IDENTITIES.seller.walletAddress
  );
  assert.equal(afterRestart.replayCursor("job-a"), "cursor-42");
  const retry = afterRestart.begin({
    eventId: "event-b",
    semanticKey: "job-b:created",
    jobId: "job-b",
  });
  assert.equal(retry.duplicate, false);
  afterRestart.fail("event-b", "simulated crash");
  const crashRetry = afterRestart.begin({
    eventId: "event-b",
    semanticKey: "job-b:created",
    jobId: "job-b",
  });
  assert.equal(crashRetry.duplicate, false);

  assert.throws(
    () =>
      new DurableEventStore(
        seller.eventStore,
        OKX_RUNTIME_IDENTITIES.buyer.agentId,
        OKX_RUNTIME_IDENTITIES.buyer.walletAddress
      ).read(),
    /event_store_agent_mismatch|event_store_wallet_mismatch/
  );
  console.log("okx-runtime-isolation-replay: all passed");
}

run();
