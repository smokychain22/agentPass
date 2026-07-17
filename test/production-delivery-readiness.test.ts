import assert from "node:assert/strict";
import { generateKeyPairSync, createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CANONICAL_SIGNING_ENV_NAMES,
  ORPHAN_SIGNING_ENV_NAMES,
  clearProductionDeliveryReadinessCache,
  cleanupDeliveryUsesInternalDispatchPat,
  parseGitHubAppPrivateKeyForReadiness,
  probeAttestationSignerReadiness,
  probeReceiptSignerReadiness,
} from "../src/lib/delivery/production-readiness";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

function generateEd25519PemPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function generateRsaPem(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

function withEnv(
  patch: Record<string, string | undefined>,
  fn: () => void | Promise<void>
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key];
    const value = patch[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  clearProductionDeliveryReadinessCache();
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      clearProductionDeliveryReadinessCache();
    });
}

async function run() {
  console.log("production-delivery-readiness");

  await test("orphan signing env names are not the canonical signer inputs", () => {
    assert.deepEqual(
      [...ORPHAN_SIGNING_ENV_NAMES],
      ["RECEIPT_SIGNING_PRIVATE_KEY", "GREEN_PR_SIGNING_PRIVATE_KEY"]
    );
    assert.equal(
      CANONICAL_SIGNING_ENV_NAMES.receiptPrivate,
      "REPODIET_RECEIPT_PRIVATE_KEY"
    );
    assert.equal(
      CANONICAL_SIGNING_ENV_NAMES.attestationPrivate,
      "REPODIET_GREEN_PR_PRIVATE_KEY"
    );
  });

  await test("cleanup delivery never uses internal dispatch PAT", () => {
    assert.equal(cleanupDeliveryUsesInternalDispatchPat(), false);
    const deliverySources = [
      "src/lib/operator/create-cleanup-pr.ts",
      "src/lib/github-app/resolve-cleanup-token.ts",
      "src/lib/asp/github-access.ts",
      "src/lib/asp/executor.ts",
    ];
    for (const relative of deliverySources) {
      const source = readFileSync(join(process.cwd(), relative), "utf8");
      assert.equal(
        source.includes("REPODIET_ACTIONS_DISPATCH_TOKEN"),
        false,
        `${relative} must not reference REPODIET_ACTIONS_DISPATCH_TOKEN`
      );
      assert.equal(
        /process\.env\.GITHUB_TOKEN\b/.test(source),
        false,
        `${relative} must not use process.env.GITHUB_TOKEN`
      );
    }
  });

  await test("receipt signer missing key is not ready", async () => {
    await withEnv({ REPODIET_RECEIPT_PRIVATE_KEY: undefined }, () => {
      const probe = probeReceiptSignerReadiness();
      assert.equal(probe.ready, false);
      assert.equal(probe.reason, "RECEIPT_SIGNER_PRIVATE_KEY_MISSING");
      assert.equal(JSON.stringify(probe).includes("BEGIN"), false);
    });
  });

  await test("receipt signer invalid key is not ready", async () => {
    await withEnv({ REPODIET_RECEIPT_PRIVATE_KEY: "not-a-real-key" }, () => {
      const probe = probeReceiptSignerReadiness();
      assert.equal(probe.ready, false);
      assert.ok(
        probe.reason === "RECEIPT_SIGNER_PRIVATE_KEY_INVALID" ||
          probe.reason === "RECEIPT_SIGNER_SELF_TEST_FAILED"
      );
      assert.equal(JSON.stringify(probe).includes("not-a-real-key"), false);
    });
  });

  await test("receipt signer passes real sign/verify self-test", async () => {
    const pair = generateEd25519PemPair();
    await withEnv(
      {
        REPODIET_RECEIPT_PRIVATE_KEY: pair.privateKeyPem,
        REPODIET_RECEIPT_PUBLIC_KEY: pair.publicKeyPem,
        REPODIET_RECEIPT_KEY_ID: "test-receipt-key",
      },
      () => {
        const probe = probeReceiptSignerReadiness();
        assert.equal(probe.ready, true);
        assert.equal(probe.reason, "RECEIPT_SIGNER_READY");
        assert.equal(probe.keyId, "test-receipt-key");
        assert.equal(JSON.stringify(probe).includes("PRIVATE KEY"), false);
      }
    );
  });

  await test("attestation signer requires distinct receipt key", async () => {
    const shared = generateEd25519PemPair();
    await withEnv(
      {
        REPODIET_RECEIPT_PRIVATE_KEY: shared.privateKeyPem,
        REPODIET_RECEIPT_PUBLIC_KEY: shared.publicKeyPem,
        REPODIET_RECEIPT_KEY_ID: "shared",
        REPODIET_GREEN_PR_PRIVATE_KEY: shared.privateKeyPem,
        REPODIET_GREEN_PR_PUBLIC_KEY: shared.publicKeyPem,
        REPODIET_GREEN_PR_KEY_ID: "shared",
      },
      () => {
        const probe = probeAttestationSignerReadiness();
        assert.equal(probe.ready, false);
        assert.equal(probe.reason, "ATTESTATION_SIGNER_SEPARATION_OF_POWERS_FAILED");
      }
    );
  });

  await test("attestation signer ready with separated keys", async () => {
    const receipt = generateEd25519PemPair();
    const attestation = generateEd25519PemPair();
    await withEnv(
      {
        REPODIET_RECEIPT_PRIVATE_KEY: receipt.privateKeyPem,
        REPODIET_RECEIPT_PUBLIC_KEY: receipt.publicKeyPem,
        REPODIET_RECEIPT_KEY_ID: "receipt-a",
        REPODIET_GREEN_PR_PRIVATE_KEY: attestation.privateKeyPem,
        REPODIET_GREEN_PR_PUBLIC_KEY: attestation.publicKeyPem,
        REPODIET_GREEN_PR_KEY_ID: "attestation-b",
      },
      () => {
        const probe = probeAttestationSignerReadiness();
        assert.equal(probe.ready, true);
        assert.equal(probe.reason, "ATTESTATION_SIGNER_READY");
        assert.equal(JSON.stringify(probe).includes("PRIVATE KEY"), false);
      }
    );
  });

  await test("orphan env names alone do not make signers ready", async () => {
    await withEnv(
      {
        RECEIPT_SIGNING_PRIVATE_KEY: "orphan",
        GREEN_PR_SIGNING_PRIVATE_KEY: "orphan",
        REPODIET_RECEIPT_PRIVATE_KEY: undefined,
        REPODIET_GREEN_PR_PRIVATE_KEY: undefined,
      },
      () => {
        assert.equal(probeReceiptSignerReadiness().ready, false);
        assert.equal(probeAttestationSignerReadiness().ready, false);
      }
    );
  });

  await test("GitHub App PEM parse accepts PKCS8 RSA", () => {
    const pem = generateRsaPem();
    const parsed = parseGitHubAppPrivateKeyForReadiness(pem);
    createPrivateKey(parsed);
    createPublicKey(createPrivateKey(parsed));
  });

  await test("GitHub App PEM parse accepts base64-encoded PEM", () => {
    const pem = generateRsaPem();
    const encoded = Buffer.from(pem, "utf8").toString("base64");
    const parsed = parseGitHubAppPrivateKeyForReadiness(encoded);
    assert.ok(parsed.includes("BEGIN"));
  });

  await test("GitHub App PEM parse rejects garbage", () => {
    assert.throws(() => parseGitHubAppPrivateKeyForReadiness("not-pem-material"));
  });

  console.log("production-delivery-readiness: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
