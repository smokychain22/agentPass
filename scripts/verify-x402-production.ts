#!/usr/bin/env tsx
/**
 * Phase 5 x402 settlement verification.
 * Usage: REPODIET_PRODUCTION_URL=... REPODIET_X402_TEST_SECRET=... npm run verify:x402
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { generateKeyPairSync } from "node:crypto";
import { verifyExecutionReceiptV1 } from "@/lib/operator/sign-receipt";
import type { SignedReceiptV1 } from "@/lib/operator/sign-receipt";

const BASE = process.env.REPODIET_PRODUCTION_URL || process.env.NEXT_PUBLIC_APP_URL || "";
const REPO = process.env.REPODIET_X402_TEST_REPO || "repodiet/demo-slop-app";
const BRANCH = "main";
const COMMIT_SHA = process.env.REPODIET_X402_TEST_COMMIT || "abc123phase5test0000001";

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

const checks: Check[] = [];

function record(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function signTestPayment(payload: Record<string, unknown>): string {
  const secret = process.env.REPODIET_X402_TEST_SECRET || "repodiet-x402-test-secret";
  return createHmac("sha256", secret)
    .update(JSON.stringify(payload, Object.keys(payload).sort()))
    .digest("hex");
}

async function main() {
  if (!BASE) {
    console.error("FAIL: Set REPODIET_PRODUCTION_URL");
    process.exit(1);
  }

  process.env.REPODIET_X402_TEST_MODE = "1";
  if (!process.env.REPODIET_X402_TEST_SECRET) {
    process.env.REPODIET_X402_TEST_SECRET = "repodiet-x402-test-secret";
  }

  console.log(`x402 settlement verify: ${BASE}`);

  const quoteRes = await fetch(`${BASE}/api/tasks/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repository: REPO,
      branch: BRANCH,
      commitSha: COMMIT_SHA,
      findingIds: ["finding_test_1"],
      operation: "quick_cleanup",
      idempotencyKey: `idem_${Date.now()}`,
    }),
  });

  record("quote returns 402", quoteRes.status === 402, `status=${quoteRes.status}`);
  const quoteBody = await quoteRes.json();
  const quote = quoteBody.quote;
  record("bound quote fields", Boolean(quote?.quoteId && quote?.requestHash && quote?.nonce));
  record("quote binding hash", Boolean(quote?.bindingHash?.startsWith("sha256:")));

  const paymentReference = `0xtest_${randomBytes(16).toString("hex")}`;
  const payer = "0x0000000000000000000000000000000000000001";
  const idempotencyKey = `idem_pay_${Date.now()}`;
  const paymentSignature = signTestPayment({
    quoteId: quote.quoteId,
    paymentReference,
    payer,
    amountMicro: quote.amountMicro,
    nonce: quote.nonce,
    requestHash: quote.requestHash,
  });

  const payRes = await fetch(`${BASE}/api/tasks/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteId: quote.quoteId,
      paymentReference,
      payer,
      idempotencyKey,
      paymentSignature,
    }),
  });
  const payJson = await payRes.json();
  record("payment funds quote", payRes.ok && payJson.status === "funded", payJson.status);

  const replayRes = await fetch(`${BASE}/api/tasks/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteId: quote.quoteId,
      paymentReference,
      payer: "0xbad",
      idempotencyKey: `idem_replay_${Date.now()}`,
      paymentSignature: "bad",
    }),
  });
  const replayJson = await replayRes.json();
  record(
    "replay rejected",
    !replayRes.ok || replayJson.status === "replayed",
    replayJson.status || replayJson.error
  );

  const wrongAmountSig = signTestPayment({
    quoteId: quote.quoteId,
    paymentReference: `0xtest_${randomBytes(8).toString("hex")}`,
    payer,
    amountMicro: "1",
    nonce: quote.nonce,
    requestHash: quote.requestHash,
  });
  const wrongRes = await fetch(`${BASE}/api/tasks/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteId: quote.quoteId,
      paymentReference: `0xtest_wrong_amount`,
      payer,
      idempotencyKey: `idem_wrong_${Date.now()}`,
      paymentSignature: wrongAmountSig,
    }),
  });
  const wrongJson = await wrongRes.json();
  record("wrong amount rejected", wrongJson.status === "wrong_amount" || !wrongRes.ok);

  const idemRes = await fetch(`${BASE}/api/tasks/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteId: quote.quoteId,
      paymentReference,
      payer,
      idempotencyKey,
      paymentSignature,
    }),
  });
  const idemJson = await idemRes.json();
  record("idempotent replay returns existing", idemRes.ok && idemJson.existingTaskId !== undefined || idemJson.status === "funded");

  if (process.env.REPODIET_OPERATOR_PRIVATE_KEY && process.env.REPODIET_OPERATOR_PUBLIC_KEY) {
    const { signExecutionReceipt } = await import("@/lib/operator/sign-receipt");
    const signed = signExecutionReceipt({
      taskId: "task_test",
      repository: REPO,
      commitSha: COMMIT_SHA,
      findingIds: ["finding_test_1"],
      patchHash: "sha256:test",
      verificationHash: "sha256:test",
      status: "completed",
      quoteId: quote.quoteId,
      paymentReference,
      timestamp: new Date().toISOString(),
    });
    record("receipt signed", Boolean(signed.signature));
    if (signed.signature && signed.signedReceipt) {
      const ok = verifyExecutionReceiptV1(
        signed.signedReceipt,
        signed.signature,
        process.env.REPODIET_OPERATOR_PUBLIC_KEY
      );
      record("receipt verifies", ok);
    }
  } else {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privatePem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const publicPem = publicKey.export({ type: "pkcs1", format: "pem" }).toString();
    process.env.REPODIET_OPERATOR_PRIVATE_KEY = privatePem;
    const { signExecutionReceipt } = await import("@/lib/operator/sign-receipt");
    const signed = signExecutionReceipt({
      taskId: "task_test",
      repository: REPO,
      commitSha: COMMIT_SHA,
      findingIds: ["finding_test_1"],
      patchHash: "sha256:test",
      verificationHash: "sha256:test",
      status: "completed",
      quoteId: quote.quoteId,
      paymentReference,
      timestamp: new Date().toISOString(),
    });
    record("receipt signed (ephemeral key)", Boolean(signed.signature));
    if (signed.signature && signed.signedReceipt) {
      record(
        "receipt verifies (ephemeral key)",
        verifyExecutionReceiptV1(signed.signedReceipt, signed.signature, publicPem)
      );
    }
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    console.error("FAILED:", failed.map((f) => f.name).join(", "));
    console.log("OVERALL: FAIL");
    process.exit(1);
  }
  console.log("OVERALL: PASS");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
