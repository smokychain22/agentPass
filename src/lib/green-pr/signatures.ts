import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { canonicalJson } from "./canonical-json";

export interface AsymmetricSigner {
  keyId: string;
  keyVersion: string;
  privateKeyPem: string;
  publicKeyPem: string;
  algorithm: "ed25519" | "sha256";
}

export interface DetachedSignature {
  keyId: string;
  keyVersion: string;
  algorithm: AsymmetricSigner["algorithm"];
  signature: string;
}

function decodeKey(value: string): string {
  return value.includes("BEGIN") ? value : Buffer.from(value, "base64").toString("utf8");
}

function signingAlgorithm(key: KeyObject): AsymmetricSigner["algorithm"] {
  return key.asymmetricKeyType === "ed25519" || key.asymmetricKeyType === "ed448"
    ? "ed25519"
    : "sha256";
}

function publicKeyFingerprint(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 24);
}

export function createAsymmetricSigner(input: {
  privateKeyPem: string;
  publicKeyPem?: string;
  keyId?: string;
  keyVersion?: string;
}): AsymmetricSigner {
  const privateKeyPem = decodeKey(input.privateKeyPem);
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKeyPem = input.publicKeyPem
    ? decodeKey(input.publicKeyPem)
    : createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  return {
    keyId: input.keyId ?? `sha256:${publicKeyFingerprint(publicKeyPem)}`,
    keyVersion: input.keyVersion ?? "1",
    privateKeyPem,
    publicKeyPem,
    algorithm: signingAlgorithm(privateKey),
  };
}

export function signerFromEnvironment(prefix: "GREEN_PR" | "RECEIPT"): AsymmetricSigner | null {
  const privateKey = process.env[`REPODIET_${prefix}_PRIVATE_KEY`];
  if (!privateKey) return null;
  return createAsymmetricSigner({
    privateKeyPem: privateKey,
    publicKeyPem: process.env[`REPODIET_${prefix}_PUBLIC_KEY`],
    keyId: process.env[`REPODIET_${prefix}_KEY_ID`],
    keyVersion: process.env[`REPODIET_${prefix}_KEY_VERSION`],
  });
}

export function signBytes(payload: Buffer, signer: AsymmetricSigner): DetachedSignature {
  const privateKey = createPrivateKey(signer.privateKeyPem);
  const signature = signer.algorithm === "ed25519"
    ? cryptoSign(null, payload, privateKey)
    : (() => {
        const builder = createSign("SHA256");
        builder.update(payload);
        builder.end();
        return builder.sign(privateKey);
      })();
  return {
    keyId: signer.keyId,
    keyVersion: signer.keyVersion,
    algorithm: signer.algorithm,
    signature: signature.toString("base64"),
  };
}

export function verifyBytes(
  payload: Buffer,
  signature: DetachedSignature,
  trustedPublicKeyPem: string
): boolean {
  try {
    const publicKey = createPublicKey(decodeKey(trustedPublicKeyPem));
    const bytes = Buffer.from(signature.signature, "base64");
    if (signature.algorithm === "ed25519") {
      return cryptoVerify(null, payload, publicKey, bytes);
    }
    const verifier = createVerify("SHA256");
    verifier.update(payload);
    verifier.end();
    return verifier.verify(publicKey, bytes);
  } catch {
    return false;
  }
}

export function signCanonicalPayload(
  payload: unknown,
  signer: AsymmetricSigner
): DetachedSignature {
  return signBytes(Buffer.from(canonicalJson(payload), "utf8"), signer);
}

export function verifyCanonicalPayload(
  payload: unknown,
  signature: DetachedSignature,
  trustedPublicKeyPem: string
): boolean {
  return verifyBytes(Buffer.from(canonicalJson(payload), "utf8"), signature, trustedPublicKeyPem);
}

export function trustedKeyMapFromEnvironment(prefix: "GREEN_PR" | "RECEIPT"):
  Record<string, string> {
  const singleKey = process.env[`REPODIET_${prefix}_PUBLIC_KEY`];
  const singleKeyId = process.env[`REPODIET_${prefix}_KEY_ID`];
  const encodedMap = process.env[`REPODIET_${prefix}_TRUSTED_PUBLIC_KEYS`];
  const result: Record<string, string> = {};

  if (encodedMap) {
    try {
      const parsed = JSON.parse(encodedMap) as Record<string, string>;
      for (const [keyId, key] of Object.entries(parsed)) result[keyId] = decodeKey(key);
    } catch {
      throw new Error(`invalid_${prefix.toLowerCase()}_trusted_public_keys`);
    }
  }

  if (singleKey) {
    const publicKeyPem = decodeKey(singleKey);
    result[singleKeyId ?? `sha256:${publicKeyFingerprint(publicKeyPem)}`] = publicKeyPem;
  }
  return result;
}
