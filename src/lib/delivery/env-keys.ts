/**
 * Canonical environment variable resolution for production delivery readiness.
 * Supports legacy aliases without renaming production variables.
 */

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function readEnvAny(names: string[]): string | undefined {
  for (const name of names) {
    const value = readEnv(name);
    if (value) return value;
  }
  return undefined;
}

export function decodePrivateKeyMaterial(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("BEGIN")) {
    return trimmed.replace(/\\n/g, "\n");
  }
  return Buffer.from(trimmed, "base64").toString("utf8");
}

/** GitHub App PEM — never fall back to operator receipt signing keys. */
export function readGitHubAppPrivateKeyRaw(): string | undefined {
  return readEnvAny(["GITHUB_APP_PRIVATE_KEY_BASE64", "GITHUB_APP_PRIVATE_KEY"]);
}

export function readGitHubAppId(): string | undefined {
  return readEnv("GITHUB_APP_ID");
}

export function readGitHubAppSlug(): string | undefined {
  return readEnv("GITHUB_APP_SLUG");
}

/** Operator commerce receipt signer (A2MCP / SignedReceiptV1). */
export function readOperatorReceiptPrivateKeyRaw(): string | undefined {
  return readEnvAny(["REPODIET_OPERATOR_PRIVATE_KEY", "RECEIPT_SIGNING_PRIVATE_KEY"]);
}

/** Green PR receipt signer (A2A delivery proof). */
export function readGreenPrReceiptPrivateKeyRaw(): string | undefined {
  return readEnvAny(["REPODIET_RECEIPT_PRIVATE_KEY", "RECEIPT_SIGNING_PRIVATE_KEY"]);
}

/** Green PR attestation signer (A2A DSSE proof). */
export function readGreenPrAttestationPrivateKeyRaw(): string | undefined {
  return readEnvAny(["REPODIET_GREEN_PR_PRIVATE_KEY", "GREEN_PR_SIGNING_PRIVATE_KEY"]);
}

export const EXPECTED_GITHUB_APP_SLUG = "repodiet-operator";
export const EXPECTED_GITHUB_APP_NAME = "RepoDiet Operator";
