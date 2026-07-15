import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  deriveOperatorPublicKeyPem,
  operatorTrustRootSource,
  resolveOperatorPublicKeyPem,
} from "../src/lib/operator/trust-root";
import { signExecutionReceipt, verifyExecutionReceiptV1 } from "../src/lib/operator/sign-receipt";

async function run() {
  console.log("operator trust root");

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  delete process.env.REPODIET_OPERATOR_PUBLIC_KEY;
  process.env.REPODIET_OPERATOR_PRIVATE_KEY = privateKey;

  const derived = deriveOperatorPublicKeyPem();
  assert.ok(derived?.includes("BEGIN PUBLIC KEY"));
  assert.equal(operatorTrustRootSource(), "derived_from_private");
  assert.equal(resolveOperatorPublicKeyPem()?.trim(), derived?.trim());

  const signed = signExecutionReceipt({
    taskId: "task_trust",
    repository: "smokychain22/agentPass",
    commitSha: "",
    findingIds: [],
    patchHash: "sha256:abc",
    verificationHash: "sha256:abc",
    status: "verified",
    quoteId: "quote_kpBaws-sNypi",
    paymentReference: "0x068547fad27d1832e0a8d4f5f9a25b9b10ca9800646f6c83e8351ea70e9ef88b",
    timestamp: new Date().toISOString(),
  });
  assert.ok(signed.signature);
  assert.equal(
    verifyExecutionReceiptV1(signed.signedReceipt, signed.signature!, derived!),
    true
  );
  assert.equal(
    verifyExecutionReceiptV1(signed.signedReceipt, signed.signature!, publicKey),
    true
  );

  process.env.REPODIET_OPERATOR_PUBLIC_KEY = publicKey;
  assert.equal(operatorTrustRootSource(), "public_env");
  assert.equal(resolveOperatorPublicKeyPem()?.trim(), publicKey.trim());

  console.log("operator trust root: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
