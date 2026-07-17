import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  readGitHubAppPrivateKeyRaw,
  readGreenPrAttestationPrivateKeyRaw,
  readGreenPrReceiptPrivateKeyRaw,
  readOperatorReceiptPrivateKeyRaw,
} from "../src/lib/delivery/env-keys";
import {
  deliveryUsesActionsDispatchPat,
  probeAttestationSignerReadiness,
  probeGitHubAppReadiness,
  probeReceiptSignerReadiness,
} from "../src/lib/delivery/readiness";

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

function withEnv(
  values: Record<string, string | undefined>,
  run: () => void | Promise<void>
): Promise<void> {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );
  return (async () => {
    try {
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await run();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  })();
}

async function run() {
  console.log("delivery-readiness");

  await test("reads GitHub App private key from base64 alias", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    await withEnv(
      {
        GITHUB_APP_PRIVATE_KEY: undefined,
        GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(privateKey, "utf8").toString("base64"),
      },
      () => {
        const raw = readGitHubAppPrivateKeyRaw();
        assert.ok(raw);
        assert.equal(raw, Buffer.from(privateKey, "utf8").toString("base64"));
      }
    );
  });

  await test("legacy receipt env aliases resolve to canonical signers", async () => {
    await withEnv(
      {
        REPODIET_OPERATOR_PRIVATE_KEY: "operator-key",
        REPODIET_RECEIPT_PRIVATE_KEY: undefined,
        RECEIPT_SIGNING_PRIVATE_KEY: "legacy-receipt",
        REPODIET_GREEN_PR_PRIVATE_KEY: undefined,
        GREEN_PR_SIGNING_PRIVATE_KEY: "legacy-green",
      },
      () => {
        assert.equal(readOperatorReceiptPrivateKeyRaw(), "operator-key");
        assert.equal(readGreenPrReceiptPrivateKeyRaw(), "legacy-receipt");
        assert.equal(readGreenPrAttestationPrivateKeyRaw(), "legacy-green");
      }
    );
  });

  await test("missing GitHub App config reports structured reasons", async () => {
    await withEnv(
      {
        GITHUB_APP_ID: undefined,
        GITHUB_APP_PRIVATE_KEY_BASE64: undefined,
        GITHUB_APP_PRIVATE_KEY: undefined,
      },
      async () => {
        const probe = await probeGitHubAppReadiness();
        assert.equal(probe.ready, false);
        assert.ok(probe.reasons.includes("GITHUB_APP_ID_MISSING"));
      }
    );
  });

  await test("signer probes perform real self-tests without exposing secrets", async () => {
    const { privateKey: operatorPrivate } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const { privateKey: receiptPrivate } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const { privateKey: attestationPrivate } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    await withEnv(
      {
        REPODIET_OPERATOR_PRIVATE_KEY: operatorPrivate,
        REPODIET_RECEIPT_PRIVATE_KEY: receiptPrivate,
        REPODIET_GREEN_PR_PRIVATE_KEY: attestationPrivate,
      },
      () => {
        const receiptProbe = probeReceiptSignerReadiness();
        assert.equal(receiptProbe.ready, true, receiptProbe.reasons.join(", "));
        const attestationProbe = probeAttestationSignerReadiness(receiptProbe.keyIds ?? []);
        assert.equal(attestationProbe.ready, true, attestationProbe.reasons.join(", "));
        const json = JSON.stringify({ receiptProbe, attestationProbe });
        assert.ok(!json.includes(operatorPrivate));
        assert.ok(!json.includes(receiptPrivate));
        assert.ok(!json.includes(attestationPrivate));
      }
    );
  });

  await test("attestation signer rejects identity collision with receipt signer", async () => {
    const { privateKey } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    await withEnv(
      {
        REPODIET_OPERATOR_PRIVATE_KEY: undefined,
        REPODIET_RECEIPT_PRIVATE_KEY: privateKey,
        REPODIET_GREEN_PR_PRIVATE_KEY: privateKey,
      },
      () => {
        const receiptProbe = probeReceiptSignerReadiness();
        const attestationProbe = probeAttestationSignerReadiness(receiptProbe.keyIds ?? []);
        assert.equal(attestationProbe.ready, false);
        assert.ok(
          attestationProbe.reasons.includes("ATTESTATION_RECEIPT_SIGNING_IDENTITY_COLLISION")
        );
      }
    );
  });

  await test("customer delivery modules do not reference dispatch PAT", () => {
    assert.equal(deliveryUsesActionsDispatchPat(process.cwd()), false);
  });

  console.log("delivery-readiness: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
