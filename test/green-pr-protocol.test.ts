import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  authorizeExecutorDispatch,
  createAsymmetricSigner,
  createGreenPrAttestation,
  independentlyVerifyGreenPr,
  planMaintenanceContract,
  REPODIET_OKX_A2A_SERVICE_ID,
  REPODIET_OKX_ASP_ID,
  REPODIET_SELLER,
  REPODIET_SETTLEMENT_ASSET,
  REPODIET_X_LAYER_NETWORK,
  signGreenPrReceipt,
  verifyGreenPrAttestation,
  type IndependentVerificationInput,
  type MaintenanceContractRecord,
} from "../src/lib/green-pr";

const SOURCE_COMMIT = "a".repeat(40);
const PATCH_COMMIT = "b".repeat(40);
const PAYER = `0x${"c".repeat(40)}`;

function signer(keyId: string) {
  const pair = generateKeyPairSync("ed25519");
  return createAsymmetricSigner({
    privateKeyPem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    keyId,
  });
}

function plannedContract(): MaintenanceContractRecord {
  const result = planMaintenanceContract(
    {
      schema: "repodiet.contract/v1",
      contractVersion: "1",
      contractId: "contract_test_001",
      repository: {
        owner: "example",
        name: "repository",
        branch: "main",
        sourceCommit: SOURCE_COMMIT,
        projectRoot: ".",
      },
      scope: {
        findingIds: ["finding_unused_import"],
        allowedPaths: ["src/example.ts"],
        protectedPaths: ["src/auth/**", ".github/**"],
        allowedOperations: ["remove_unused_import"],
        maxFilesChanged: 1,
        maxLinesAdded: 0,
        maxLinesDeleted: 5,
        maxDependencyChanges: 0,
      },
      verificationPolicy: {
        baselineRequired: true,
        requiredCommands: ["npm test"],
        requiredGitHubChecks: ["ci"],
        allowNewDiagnostics: false,
        allowSkippedChecks: false,
        timeoutSeconds: 300,
      },
      delivery: {
        isolatedBranchRequired: true,
        pullRequestRequired: true,
        directMainPushAllowed: false,
        autoMergeAllowed: false,
        revisionLimit: 1,
      },
      commercialTerms: {
        aspId: REPODIET_OKX_ASP_ID,
        serviceId: REPODIET_OKX_A2A_SERVICE_ID,
        quoteId: "quote_test_001",
        amount: "1",
        asset: REPODIET_SETTLEMENT_ASSET,
        network: REPODIET_X_LAYER_NETWORK,
        payer: PAYER,
        recipient: REPODIET_SELLER,
        expiry: "2030-01-01T00:00:00.000Z",
      },
      acceptancePolicy: {
        blockingChecksMustPass: true,
        attestationMustVerify: true,
        sourceCommitMustMatch: true,
        scopeMustMatch: true,
        receiptMustVerify: true,
      },
      warrantyPolicy: {
        enabled: false,
        durationHours: 0,
        monitoredChecks: [],
        attributableRegressionAction: "OPEN_REPAIR",
      },
    },
    new Date("2026-07-15T00:00:00.000Z")
  );
  return { ...result.contractRecord, status: "accepted" };
}

function successfulVerificationFixture() {
  const contractRecord = plannedContract();
  const dispatch = authorizeExecutorDispatch(contractRecord, {
    contractDigest: contractRecord.contractDigest,
    sourceCommit: SOURCE_COMMIT,
    findingIds: ["finding_unused_import"],
    changes: [
      {
        path: "src/example.ts",
        operation: "remove_unused_import",
        linesAdded: 0,
        linesDeleted: 1,
      },
    ],
  });
  const receiptSigner = signer("receipt-key-v1");
  const receipt = signGreenPrReceipt(
    {
      receiptVersion: "1",
      receiptId: "receipt_test_001",
      contractDigest: contractRecord.contractDigest,
      aspId: REPODIET_OKX_ASP_ID,
      serviceId: REPODIET_OKX_A2A_SERVICE_ID,
      quoteId: "quote_test_001",
      taskId: "task_test_001",
      paymentReference: "okx-escrow-test-reference",
      repository: "example/repository",
      sourceCommit: SOURCE_COMMIT,
      amount: "1",
      asset: REPODIET_SETTLEMENT_ASSET,
      network: REPODIET_X_LAYER_NETWORK,
      payer: PAYER,
      recipient: REPODIET_SELLER,
      idempotencyKey: "green-pr-contract-test-001",
      deliveryId: "delivery_test_001",
      issuedAt: "2026-07-15T00:01:00.000Z",
    },
    receiptSigner
  );
  const verificationInput: IndependentVerificationInput = {
    contractRecord,
    contractDigest: contractRecord.contractDigest,
    repository: "example/repository",
    sourceCommit: SOURCE_COMMIT,
    patchCommit: PATCH_COMMIT,
    pullRequest: {
      url: "https://github.com/example/repository/pull/1",
      number: 1,
      headCommit: PATCH_COMMIT,
    },
    executorDispatch: dispatch,
    baselineCommands: [{ command: "npm test", status: "passed" }],
    patchedCommands: [{ command: "npm test", status: "passed" }],
    baselineDiagnostics: [],
    patchedDiagnostics: [],
    githubChecks: [{ name: "ci", status: "passed" }],
    receipt,
    trustedReceiptKeys: { [receiptSigner.keyId]: receiptSigner.publicKeyPem },
  };
  return { contractRecord, verificationInput, receipt, receiptSigner };
}

test("maintenance contract digest is stable after normalization", () => {
  const first = plannedContract();
  const second = plannedContract();
  assert.equal(first.contractDigest, second.contractDigest);
  assert.match(first.contractDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.contract.schema, "repodiet.contract/v1");
});

test("executor rejects a protected or out-of-contract path", () => {
  const contract = plannedContract();
  assert.throws(
    () => authorizeExecutorDispatch(contract, {
      contractDigest: contract.contractDigest,
      sourceCommit: SOURCE_COMMIT,
      findingIds: ["finding_unused_import"],
      changes: [{
        path: "src/auth/session.ts",
        operation: "remove_unused_import",
        linesAdded: 0,
        linesDeleted: 1,
      }],
    }),
    /path_outside_scope/
  );
});

test("verifier ignores executor optimism and rejects a failed required command", () => {
  const fixture = successfulVerificationFixture();
  fixture.verificationInput.patchedCommands = [{ command: "npm test", status: "failed" }];
  const decision = independentlyVerifyGreenPr(
    fixture.verificationInput,
    new Date("2026-07-15T00:02:00.000Z")
  );
  assert.equal(decision.contractSatisfied, false);
  assert.equal(decision.acceptanceRecommendation, "REJECT");
  assert.equal(
    decision.checks.find((entry) => entry.name === "required_commands")?.passed,
    false
  );
});

test("separately signed DSSE Green PR attestation verifies and detects tampering", () => {
  const fixture = successfulVerificationFixture();
  const decision = independentlyVerifyGreenPr(
    fixture.verificationInput,
    new Date("2026-07-15T00:02:00.000Z")
  );
  assert.equal(decision.acceptanceRecommendation, "ACCEPT");

  const verifierSigner = signer("verifier-key-v1");
  assert.notEqual(
    verifierSigner.keyId,
    fixture.receipt.signature.keyId,
    "attestation and receipt must use separate signing identities"
  );
  const attestation = createGreenPrAttestation({
    verificationInput: fixture.verificationInput,
    decision,
    receipt: fixture.receipt,
    tools: [{
      name: "repodiet-green-pr-verifier",
      version: "1.0.0",
      configurationDigest: `sha256:${"d".repeat(64)}`,
    }],
    signer: verifierSigner,
    now: new Date("2026-07-15T00:03:00.000Z"),
  });
  const valid = verifyGreenPrAttestation(attestation, {
    contractRecord: fixture.contractRecord,
    trustedPublicKeys: { [verifierSigner.keyId]: verifierSigner.publicKeyPem },
    expectedRepository: "example/repository",
    expectedSourceCommit: SOURCE_COMMIT,
    expectedPrHeadCommit: PATCH_COMMIT,
    expectedPullRequestNumber: 1,
    receipt: fixture.receipt,
    trustedReceiptPublicKeys: {
      [fixture.receiptSigner.keyId]: fixture.receiptSigner.publicKeyPem,
    },
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.receiptValid, true);
  assert.equal(valid.acceptanceRecommendation, "ACCEPT");

  const tampered = structuredClone(attestation);
  const statement = JSON.parse(Buffer.from(tampered.envelope.payload, "base64").toString("utf8"));
  statement.predicate.pullRequest.headCommit = "e".repeat(40);
  tampered.envelope.payload = Buffer.from(JSON.stringify(statement), "utf8").toString("base64");
  const invalid = verifyGreenPrAttestation(tampered, {
    contractRecord: fixture.contractRecord,
    trustedPublicKeys: { [verifierSigner.keyId]: verifierSigner.publicKeyPem },
    receipt: fixture.receipt,
    trustedReceiptPublicKeys: {
      [fixture.receiptSigner.keyId]: fixture.receiptSigner.publicKeyPem,
    },
  });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.signatureValid, false);
  assert.equal(invalid.acceptanceRecommendation, "REJECT");
});

test("a valid signature cannot hide out-of-contract work or missing verification", () => {
  const fixture = successfulVerificationFixture();
  const honestDecision = independentlyVerifyGreenPr(
    fixture.verificationInput,
    new Date("2026-07-15T00:02:00.000Z")
  );
  assert.equal(honestDecision.acceptanceRecommendation, "ACCEPT");

  const dishonestInput = structuredClone(fixture.verificationInput);
  dishonestInput.executorDispatch.changes[0] = {
    ...dishonestInput.executorDispatch.changes[0],
    path: "src/auth/session.ts",
  };
  dishonestInput.patchedCommands = [];
  const verifierSigner = signer("verifier-key-adversarial-v1");
  const signedButFalse = createGreenPrAttestation({
    verificationInput: dishonestInput,
    decision: honestDecision,
    receipt: fixture.receipt,
    tools: [{
      name: "repodiet-green-pr-verifier",
      version: "1.0.0",
      configurationDigest: `sha256:${"d".repeat(64)}`,
    }],
    signer: verifierSigner,
    now: new Date("2026-07-15T00:03:00.000Z"),
  });
  const result = verifyGreenPrAttestation(signedButFalse, {
    contractRecord: fixture.contractRecord,
    trustedPublicKeys: { [verifierSigner.keyId]: verifierSigner.publicKeyPem },
    receipt: fixture.receipt,
    trustedReceiptPublicKeys: {
      [fixture.receiptSigner.keyId]: fixture.receiptSigner.publicKeyPem,
    },
  });

  assert.equal(result.signatureValid, true);
  assert.equal(result.scopeRespected, false);
  assert.equal(result.requiredChecksPassed, false);
  assert.equal(result.valid, false);
  assert.match(result.reasons.join(","), /path_outside_scope/);
});

test("attestation signing rejects reuse of the receipt signing identity", () => {
  const fixture = successfulVerificationFixture();
  const decision = independentlyVerifyGreenPr(fixture.verificationInput);
  assert.throws(
    () => createGreenPrAttestation({
      verificationInput: fixture.verificationInput,
      decision,
      receipt: fixture.receipt,
      tools: [{
        name: "repodiet-green-pr-verifier",
        version: "1.0.0",
        configurationDigest: `sha256:${"d".repeat(64)}`,
      }],
      signer: fixture.receiptSigner,
    }),
    /separation_of_powers/
  );
});

test("signer construction rejects a public key that does not match its private key", () => {
  const privatePair = generateKeyPairSync("ed25519");
  const otherPair = generateKeyPairSync("ed25519");
  assert.throws(
    () => createAsymmetricSigner({
      privateKeyPem: privatePair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      publicKeyPem: otherPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    }),
    /does_not_match/
  );
});

test("signer construction accepts harmless PEM whitespace from secret stores", () => {
  const pair = generateKeyPairSync("ed25519");
  const signer = createAsymmetricSigner({
    privateKeyPem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: `${pair.publicKey.export({ type: "spki", format: "pem" }).toString()}\n`,
  });
  assert.equal(signer.algorithm, "ed25519");
});

console.log("green-pr-protocol.test.ts: ok");
