import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  buildBindingAttestationFromReceipt,
  signBindingAttestation,
  verifyBindingAttestation,
  ORIGINAL_RECEIPT_QUOTE_DIGEST_STATUS,
  originalReceiptSignatureDigest,
} from "../src/lib/operator/binding-attestation";
import { signExecutionReceipt, verifyExecutionReceiptV1 } from "../src/lib/operator/sign-receipt";
import {
  operatorTrustRootSource,
  resolveOperatorPublicKeyPem,
  trustRootUsesPrivateDerivation,
} from "../src/lib/operator/trust-root";
import { PINNED_OPERATOR_PUBLIC_KEY_PEM } from "../src/lib/operator/pinned-operator-public-key";
import type { PaymentReceipt } from "../src/lib/okx/types";

async function run() {
  console.log("binding attestation + pinned trust root");

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  process.env.REPODIET_OPERATOR_PRIVATE_KEY = privateKey;
  process.env.REPODIET_OPERATOR_PUBLIC_KEY = publicKey;
  delete process.env.VERCEL_ENV;

  const signed = signExecutionReceipt({
    taskId: "task_83a1cd6430a644",
    repository: "smokychain22/agentPass",
    commitSha: "",
    findingIds: [],
    patchHash: "sha256:eb3926e492acd957ee3e030dc0b9cb100bd46feec161f18b500060dee05587ef",
    verificationHash: "sha256:eb3926e492acd957ee3e030dc0b9cb100bd46feec161f18b500060dee05587ef",
    status: "verified",
    quoteId: "quote_kpBaws-sNypi",
    timestamp: "2026-07-15T20:29:53.621Z",
  });
  assert.ok(signed.signature);
  assert.equal(
    verifyExecutionReceiptV1(signed.signedReceipt, signed.signature!, publicKey),
    true
  );
  const canonical = JSON.stringify({
    version: signed.signedReceipt.version,
    operator: signed.signedReceipt.operator,
    taskId: signed.signedReceipt.taskId,
    quoteId: signed.signedReceipt.quoteId ?? null,
    paymentReference: signed.signedReceipt.paymentReference ?? null,
    repository: signed.signedReceipt.repository,
    commitSha: signed.signedReceipt.commitSha,
    findingIds: [...signed.signedReceipt.findingIds].sort(),
    patchHash: signed.signedReceipt.patchHash,
    verificationHash: signed.signedReceipt.verificationHash,
    pullRequestUrl: signed.signedReceipt.pullRequestUrl ?? null,
    status: signed.signedReceipt.status,
    timestamp: signed.signedReceipt.timestamp,
  });
  assert.equal(canonical.includes("eaf3dbd6"), false);
  assert.equal(
    ORIGINAL_RECEIPT_QUOTE_DIGEST_STATUS,
    "ORIGINAL_RECEIPT_DOES_NOT_CRYPTOGRAPHICALLY_BIND_QUOTE_DIGEST"
  );

  const receipt: PaymentReceipt = {
    receiptId: "receipt_OkwZLE67jSCT",
    serviceId: "analyze_repository",
    serviceType: "A2MCP",
    taskId: "task_83a1cd6430a644",
    requestHash: "sha256:6719e581938926354c2e06ad60fd01913729aaf964da171ae513fa3cb91a6efc",
    resultHash: "sha256:eb3926e492acd957ee3e030dc0b9cb100bd46feec161f18b500060dee05587ef",
    resultDigest: "sha256:eb3926e492acd957ee3e030dc0b9cb100bd46feec161f18b500060dee05587ef",
    signature: signed.signature!,
    signedReceipt: signed.signedReceipt as unknown as Record<string, unknown>,
    operatorAgentId: "5283",
    timestamp: "2026-07-15T20:29:53.621Z",
    quoteId: "quote_kpBaws-sNypi",
    paymentReference: "0x068547fad27d1832e0a8d4f5f9a25b9b10ca9800646f6c83e8351ea70e9ef88b",
    buyer: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
    seller: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    amountMicro: "30000",
    token: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    network: "eip155:196",
    operation: "analyze_repository",
    repository: "smokychain22/agentPass",
  };

  const attestation = buildBindingAttestationFromReceipt(receipt, {
    quoteRequestDigest:
      "sha256:eaf3dbd6c09347190fd1502a25490462f5a4d519d2b1f2b77776e225449f9937",
    executionRequestDigest:
      "sha256:6719e581938926354c2e06ad60fd01913729aaf964da171ae513fa3cb91a6efc",
  });
  assert.equal(
    attestation.originalReceiptSignatureDigest,
    originalReceiptSignatureDigest(receipt.signature!)
  );
  const signedAtt = signBindingAttestation(attestation);
  assert.equal(
    verifyBindingAttestation(signedAtt.attestation, signedAtt.signature, publicKey),
    true
  );
  assert.match(signedAtt.canonical, /eaf3dbd6/);
  assert.match(signedAtt.canonical, /6719e581/);

  // Production-like: PUBLIC_KEY unset → pinned constant, NOT private derivation
  delete process.env.REPODIET_OPERATOR_PUBLIC_KEY;
  process.env.VERCEL_ENV = "production";
  assert.equal(operatorTrustRootSource(), "pinned_constant");
  assert.equal(trustRootUsesPrivateDerivation(), false);
  assert.ok(resolveOperatorPublicKeyPem()?.includes("BEGIN PUBLIC KEY"));
  assert.ok(PINNED_OPERATOR_PUBLIC_KEY_PEM.includes("BEGIN PUBLIC KEY"));

  console.log("binding attestation + pinned trust root: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
