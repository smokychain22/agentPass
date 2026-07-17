/**
 * Canonical production delivery readiness probes.
 *
 * Single source of truth for:
 *   - githubAppReady
 *   - receiptSignerReady
 *   - attestationSignerReady
 *
 * Flags become true only after real capability checks (not env-presence alone,
 * and never hardcoded). Reasons are structured codes with no secret material.
 */

import { createPrivateKey, createPublicKey } from "node:crypto";
import { createGitHubAppJwt } from "@/lib/github-app/jwt";
import { createInstallationAccessToken } from "@/lib/github-app/installations";
import {
  assertSigningIdentitySeparation,
  createAsymmetricSigner,
  signCanonicalPayload,
  signerFromEnvironment,
  verifyCanonicalPayload,
} from "@/lib/green-pr/signatures";

export const EXPECTED_GITHUB_APP_SLUG = "repodiet-operator";
export const EXPECTED_GITHUB_APP_NAME = "RepoDiet Operator";

/** Minimum repository permissions required for cleanup PR delivery. */
export const REQUIRED_GITHUB_APP_PERMISSIONS = {
  metadata: "read",
  contents: "write",
  pull_requests: "write",
} as const;

/**
 * Optional read permissions that are currently used by PR check monitoring
 * and Actions evidence retrieval. Required for platform readiness while used.
 */
export const USED_OPTIONAL_GITHUB_APP_PERMISSIONS = {
  checks: "read",
  statuses: "read",
  actions: "read",
} as const;

export type GitHubAppReadyReason =
  | "GITHUB_APP_ID_MISSING"
  | "GITHUB_APP_PRIVATE_KEY_MISSING"
  | "GITHUB_APP_PRIVATE_KEY_INVALID"
  | "GITHUB_APP_SLUG_MISSING"
  | "GITHUB_APP_AUTH_FAILED"
  | "GITHUB_APP_IDENTITY_MISMATCH"
  | "GITHUB_APP_REQUIRED_PERMISSION_MISSING"
  | "GITHUB_APP_INSTALLATION_NOT_FOUND"
  | "GITHUB_APP_INSTALLATION_TOKEN_FAILED"
  | "GITHUB_APP_DELIVERY_USES_DISPATCH_PAT"
  | "GITHUB_APP_READY";

export type ReceiptSignerReadyReason =
  | "RECEIPT_SIGNER_PRIVATE_KEY_MISSING"
  | "RECEIPT_SIGNER_PRIVATE_KEY_INVALID"
  | "RECEIPT_SIGNER_SELF_TEST_FAILED"
  | "RECEIPT_SIGNER_READY";

export type AttestationSignerReadyReason =
  | "ATTESTATION_SIGNER_PRIVATE_KEY_MISSING"
  | "ATTESTATION_SIGNER_PRIVATE_KEY_INVALID"
  | "ATTESTATION_SIGNER_SELF_TEST_FAILED"
  | "ATTESTATION_SIGNER_SEPARATION_OF_POWERS_FAILED"
  | "ATTESTATION_SIGNER_READY";

export interface GitHubAppReadiness {
  githubAppReady: boolean;
  reason: GitHubAppReadyReason;
  message: string;
  /** App slug observed from GitHub (never secrets). */
  appSlug?: string;
  appName?: string;
  missingPermissions?: string[];
  installationProbeOk?: boolean;
}

export interface SignerReadiness {
  ready: boolean;
  reason: string;
  message: string;
  keyId?: string;
}

export interface ProductionDeliveryReadiness {
  githubAppReady: boolean;
  githubAppReadyReason: GitHubAppReadyReason;
  githubAppReadyMessage: string;
  receiptSignerReady: boolean;
  receiptSignerReadyReason: ReceiptSignerReadyReason;
  receiptSignerReadyMessage: string;
  attestationSignerReady: boolean;
  attestationSignerReadyReason: AttestationSignerReadyReason;
  attestationSignerReadyMessage: string;
  checkedAt: string;
}

const PRIVATE_KEY_ENV_CANDIDATES = [
  "GITHUB_APP_PRIVATE_KEY_BASE64",
  "GITHUB_APP_PRIVATE_KEY",
] as const;

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function readEnvAny(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = readEnv(name);
    if (value) return value;
  }
  return undefined;
}

function decodePrivateKeyPem(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("BEGIN")) {
    return trimmed.replace(/\\n/g, "\n");
  }
  return Buffer.from(trimmed, "base64").toString("utf8");
}

function permissionSatisfies(actual: string | undefined, required: "read" | "write"): boolean {
  if (!actual) return false;
  if (required === "read") return actual === "read" || actual === "write";
  return actual === "write";
}

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function identitiesMatch(slug: string | undefined, name: string | undefined): boolean {
  const expectedSlug = normalizeIdentity(EXPECTED_GITHUB_APP_SLUG);
  const expectedName = normalizeIdentity(EXPECTED_GITHUB_APP_NAME);
  const configuredSlug = readEnv("GITHUB_APP_SLUG");

  if (configuredSlug && normalizeIdentity(configuredSlug) !== expectedSlug) {
    return false;
  }
  if (slug && normalizeIdentity(slug) !== expectedSlug) {
    return false;
  }
  if (name && normalizeIdentity(name) !== expectedName && normalizeIdentity(name) !== expectedSlug) {
    return false;
  }
  // Prefer API slug when present; env slug alone is insufficient without GitHub confirmation.
  return Boolean(slug || name);
}

/**
 * Static invariant: customer cleanup delivery must use GitHub App installation
 * tokens only — never REPODIET_ACTIONS_DISPATCH_TOKEN / customer PATs / GITHUB_TOKEN.
 * Enforced in create-cleanup-pr → resolveCleanupGitHubToken / ASP resolveAspGitHubToken.
 */
export function cleanupDeliveryUsesInternalDispatchPat(): boolean {
  return false;
}

function githubAppHeaders(jwt: string): Record<string, string> {
  return {
    Authorization: `Bearer ${jwt}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "RepoDiet-DeliveryReadiness",
  };
}

export async function probeGitHubAppReadiness(): Promise<GitHubAppReadiness> {
  if (!readEnv("GITHUB_APP_ID")) {
    return {
      githubAppReady: false,
      reason: "GITHUB_APP_ID_MISSING",
      message: "GITHUB_APP_ID is not configured.",
    };
  }

  // Prefer dedicated App key env vars. OPERATOR private key is only a legacy
  // fallback used by getGitHubAppConfig — do not treat it as the primary signal.
  const dedicatedKey = readEnvAny(PRIVATE_KEY_ENV_CANDIDATES);
  const legacyOperatorFallback = readEnv("REPODIET_OPERATOR_PRIVATE_KEY");
  const privateKeyRaw = dedicatedKey ?? legacyOperatorFallback;
  if (!privateKeyRaw) {
    return {
      githubAppReady: false,
      reason: "GITHUB_APP_PRIVATE_KEY_MISSING",
      message:
        "GitHub App private key is not configured (GITHUB_APP_PRIVATE_KEY_BASE64 or GITHUB_APP_PRIVATE_KEY).",
    };
  }

  if (!readEnv("GITHUB_APP_SLUG")) {
    return {
      githubAppReady: false,
      reason: "GITHUB_APP_SLUG_MISSING",
      message: "GITHUB_APP_SLUG is not configured.",
    };
  }

  let privateKeyPem: string;
  try {
    privateKeyPem = decodePrivateKeyPem(privateKeyRaw);
    createPrivateKey(privateKeyPem);
  } catch {
    return {
      githubAppReady: false,
      reason: "GITHUB_APP_PRIVATE_KEY_INVALID",
      message: "GitHub App private key PEM could not be parsed.",
    };
  }

  // Ensure JWT material works (also validates getGitHubAppConfig completeness).
  let appJwt: string;
  try {
    appJwt = createGitHubAppJwt();
    if (!appJwt || appJwt.split(".").length !== 3) {
      throw new Error("jwt_malformed");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    if (/not fully configured|environment variables/i.test(msg)) {
      return {
        githubAppReady: false,
        reason: "GITHUB_APP_AUTH_FAILED",
        message:
          "GitHub App JWT could not be generated — App ID, private key, client credentials, and slug must all be configured.",
      };
    }
    return {
      githubAppReady: false,
      reason: "GITHUB_APP_PRIVATE_KEY_INVALID",
      message: "GitHub App JWT could not be generated from the configured private key.",
    };
  }

  // Silence unused in production builds when parse succeeds but we only needed validation.
  void privateKeyPem;

  let appJson: {
    id?: number;
    slug?: string;
    name?: string;
    permissions?: Record<string, string>;
  };
  try {
    const res = await fetch("https://api.github.com/app", {
      headers: githubAppHeaders(appJwt),
    });
    if (res.status === 401 || res.status === 403) {
      return {
        githubAppReady: false,
        reason: "GITHUB_APP_AUTH_FAILED",
        message: `GitHub rejected the App JWT (${res.status}).`,
      };
    }
    if (!res.ok) {
      return {
        githubAppReady: false,
        reason: "GITHUB_APP_AUTH_FAILED",
        message: `Failed to fetch GitHub App metadata (${res.status}).`,
      };
    }
    appJson = (await res.json()) as typeof appJson;
  } catch {
    return {
      githubAppReady: false,
      reason: "GITHUB_APP_AUTH_FAILED",
      message: "Network error while authenticating the GitHub App.",
    };
  }

  if (!identitiesMatch(appJson.slug, appJson.name)) {
    return {
      githubAppReady: false,
      reason: "GITHUB_APP_IDENTITY_MISMATCH",
      message: `Configured App must be ${EXPECTED_GITHUB_APP_NAME} (slug ${EXPECTED_GITHUB_APP_SLUG}).`,
      appSlug: appJson.slug,
      appName: appJson.name,
    };
  }

  const permissions = appJson.permissions ?? {};
  const missingPermissions: string[] = [];
  for (const [perm, level] of Object.entries(REQUIRED_GITHUB_APP_PERMISSIONS)) {
    if (!permissionSatisfies(permissions[perm], level)) {
      missingPermissions.push(`${perm}:${level}`);
    }
  }
  for (const [perm, level] of Object.entries(USED_OPTIONAL_GITHUB_APP_PERMISSIONS)) {
    if (!permissionSatisfies(permissions[perm], level)) {
      missingPermissions.push(`${perm}:${level}`);
    }
  }
  if (missingPermissions.length > 0) {
    return {
      githubAppReady: false,
      reason: "GITHUB_APP_REQUIRED_PERMISSION_MISSING",
      message: `GitHub App is missing required permissions: ${missingPermissions.join(", ")}.`,
      appSlug: appJson.slug,
      appName: appJson.name,
      missingPermissions,
    };
  }

  if (cleanupDeliveryUsesInternalDispatchPat()) {
    return {
      githubAppReady: false,
      reason: "GITHUB_APP_DELIVERY_USES_DISPATCH_PAT",
      message:
        "Cleanup delivery must not use REPODIET_ACTIONS_DISPATCH_TOKEN; use GitHub App installation tokens only.",
      appSlug: appJson.slug,
      appName: appJson.name,
    };
  }

  let installationId: number | undefined;
  try {
    const listRes = await fetch("https://api.github.com/app/installations?per_page=1", {
      headers: githubAppHeaders(appJwt),
    });
    if (!listRes.ok) {
      return {
        githubAppReady: false,
        reason: "GITHUB_APP_AUTH_FAILED",
        message: `Failed to list GitHub App installations (${listRes.status}).`,
        appSlug: appJson.slug,
        appName: appJson.name,
      };
    }
    const installations = (await listRes.json()) as Array<{ id?: number }>;
    installationId = installations[0]?.id;
  } catch {
    return {
      githubAppReady: false,
      reason: "GITHUB_APP_AUTH_FAILED",
      message: "Network error while listing GitHub App installations.",
      appSlug: appJson.slug,
      appName: appJson.name,
    };
  }

  if (!installationId) {
    return {
      githubAppReady: false,
      reason: "GITHUB_APP_INSTALLATION_NOT_FOUND",
      message:
        "GitHub App has no installations. Install RepoDiet Operator on at least one account to verify installation-token minting.",
      appSlug: appJson.slug,
      appName: appJson.name,
      installationProbeOk: false,
    };
  }

  try {
    const token = await createInstallationAccessToken(installationId);
    if (!token.token || !token.expiresAt) {
      throw new Error("empty_installation_token");
    }
  } catch {
    return {
      githubAppReady: false,
      reason: "GITHUB_APP_INSTALLATION_TOKEN_FAILED",
      message: "Failed to mint a GitHub App installation access token.",
      appSlug: appJson.slug,
      appName: appJson.name,
      installationProbeOk: false,
    };
  }

  return {
    githubAppReady: true,
    reason: "GITHUB_APP_READY",
    message: "GitHub App platform checks passed for RepoDiet Operator delivery.",
    appSlug: appJson.slug,
    appName: appJson.name,
    installationProbeOk: true,
  };
}

function probeGreenPrSigner(prefix: "RECEIPT" | "GREEN_PR"): SignerReadiness {
  const missingReason =
    prefix === "RECEIPT"
      ? "RECEIPT_SIGNER_PRIVATE_KEY_MISSING"
      : "ATTESTATION_SIGNER_PRIVATE_KEY_MISSING";
  const invalidReason =
    prefix === "RECEIPT"
      ? "RECEIPT_SIGNER_PRIVATE_KEY_INVALID"
      : "ATTESTATION_SIGNER_PRIVATE_KEY_INVALID";
  const selfTestReason =
    prefix === "RECEIPT"
      ? "RECEIPT_SIGNER_SELF_TEST_FAILED"
      : "ATTESTATION_SIGNER_SELF_TEST_FAILED";
  const readyReason =
    prefix === "RECEIPT" ? "RECEIPT_SIGNER_READY" : "ATTESTATION_SIGNER_READY";
  const envName = `REPODIET_${prefix}_PRIVATE_KEY`;

  const privateKey = process.env[envName]?.trim();
  if (!privateKey) {
    return {
      ready: false,
      reason: missingReason,
      message: `${envName} is not configured.`,
    };
  }

  let signer;
  try {
    signer = signerFromEnvironment(prefix);
    if (!signer) {
      return {
        ready: false,
        reason: missingReason,
        message: `${envName} is not configured.`,
      };
    }
    // Confirm PEM material is loadable independently of signer helpers.
    createPrivateKey(
      privateKey.includes("BEGIN")
        ? privateKey
        : Buffer.from(privateKey, "base64").toString("utf8")
    );
    createPublicKey(signer.publicKeyPem);
  } catch {
    return {
      ready: false,
      reason: invalidReason,
      message: `${envName} could not be parsed as a signing key.`,
    };
  }

  try {
    const probePayload = {
      purpose: "repodiet_delivery_readiness_self_test",
      prefix,
      keyId: signer.keyId,
      nonce: `${Date.now()}`,
    };
    const signature = signCanonicalPayload(probePayload, signer);
    const verified = verifyCanonicalPayload(
      probePayload,
      signature,
      signer.publicKeyPem
    );
    if (!verified) {
      return {
        ready: false,
        reason: selfTestReason,
        message: `${prefix} signer self-test failed: signature did not verify.`,
        keyId: signer.keyId,
      };
    }
  } catch {
    return {
      ready: false,
      reason: selfTestReason,
      message: `${prefix} signer self-test failed.`,
      keyId: signer.keyId,
    };
  }

  return {
    ready: true,
    reason: readyReason,
    message: `${prefix} signer is ready.`,
    keyId: signer.keyId,
  };
}

export function probeReceiptSignerReadiness(): SignerReadiness & {
  reason: ReceiptSignerReadyReason;
} {
  const result = probeGreenPrSigner("RECEIPT");
  return {
    ...result,
    reason: result.reason as ReceiptSignerReadyReason,
  };
}

export function probeAttestationSignerReadiness(): SignerReadiness & {
  reason: AttestationSignerReadyReason;
} {
  const attestation = probeGreenPrSigner("GREEN_PR");
  if (!attestation.ready) {
    return {
      ...attestation,
      reason: attestation.reason as AttestationSignerReadyReason,
    };
  }

  const receipt = probeGreenPrSigner("RECEIPT");
  if (receipt.ready) {
    try {
      const receiptSigner = signerFromEnvironment("RECEIPT");
      const attestationSigner = signerFromEnvironment("GREEN_PR");
      if (receiptSigner && attestationSigner) {
        assertSigningIdentitySeparation(receiptSigner, attestationSigner);
      }
    } catch {
      return {
        ready: false,
        reason: "ATTESTATION_SIGNER_SEPARATION_OF_POWERS_FAILED",
        message:
          "Receipt and attestation signing keys must be distinct (separation of powers).",
        keyId: attestation.keyId,
      };
    }
  }

  return {
    ...attestation,
    reason: "ATTESTATION_SIGNER_READY",
  };
}

/** @deprecated Orphan health env names — never used by real signers. Kept for docs/migrations. */
export const ORPHAN_SIGNING_ENV_NAMES = [
  "RECEIPT_SIGNING_PRIVATE_KEY",
  "GREEN_PR_SIGNING_PRIVATE_KEY",
] as const;

/** Env names actually consumed by Green PR / operator signing code. */
export const CANONICAL_SIGNING_ENV_NAMES = {
  receiptPrivate: "REPODIET_RECEIPT_PRIVATE_KEY",
  receiptPublic: "REPODIET_RECEIPT_PUBLIC_KEY",
  receiptKeyId: "REPODIET_RECEIPT_KEY_ID",
  receiptKeyVersion: "REPODIET_RECEIPT_KEY_VERSION",
  attestationPrivate: "REPODIET_GREEN_PR_PRIVATE_KEY",
  attestationPublic: "REPODIET_GREEN_PR_PUBLIC_KEY",
  attestationKeyId: "REPODIET_GREEN_PR_KEY_ID",
  attestationKeyVersion: "REPODIET_GREEN_PR_KEY_VERSION",
  operatorPrivate: "REPODIET_OPERATOR_PRIVATE_KEY",
  operatorPublic: "REPODIET_OPERATOR_PUBLIC_KEY",
  githubAppId: "GITHUB_APP_ID",
  githubAppPrivateKeyBase64: "GITHUB_APP_PRIVATE_KEY_BASE64",
  githubAppPrivateKey: "GITHUB_APP_PRIVATE_KEY",
  githubAppSlug: "GITHUB_APP_SLUG",
  githubAppClientId: "GITHUB_APP_CLIENT_ID",
  githubAppClientSecret: "GITHUB_APP_CLIENT_SECRET",
} as const;

let cachedReadiness: { value: ProductionDeliveryReadiness; expiresAt: number } | null =
  null;
const READINESS_CACHE_MS = 45_000;

export async function getProductionDeliveryReadiness(options?: {
  bypassCache?: boolean;
}): Promise<ProductionDeliveryReadiness> {
  const now = Date.now();
  if (
    !options?.bypassCache &&
    cachedReadiness &&
    cachedReadiness.expiresAt > now
  ) {
    return cachedReadiness.value;
  }

  const [github, receipt, attestation] = await Promise.all([
    probeGitHubAppReadiness(),
    Promise.resolve(probeReceiptSignerReadiness()),
    Promise.resolve(probeAttestationSignerReadiness()),
  ]);

  const value: ProductionDeliveryReadiness = {
    githubAppReady: github.githubAppReady,
    githubAppReadyReason: github.reason,
    githubAppReadyMessage: github.message,
    receiptSignerReady: receipt.ready,
    receiptSignerReadyReason: receipt.reason,
    receiptSignerReadyMessage: receipt.message,
    attestationSignerReady: attestation.ready,
    attestationSignerReadyReason: attestation.reason,
    attestationSignerReadyMessage: attestation.message,
    checkedAt: new Date().toISOString(),
  };

  cachedReadiness = { value, expiresAt: now + READINESS_CACHE_MS };
  return value;
}

/** Test helper — clears the readiness probe cache. */
export function clearProductionDeliveryReadinessCache(): void {
  cachedReadiness = null;
}

/** Exported for tests — validates PEM parse without network. */
export function parseGitHubAppPrivateKeyForReadiness(raw: string): string {
  const pem = decodePrivateKeyPem(raw);
  createPrivateKey(pem);
  return pem;
}

/** Exported for tests — builds a signer the same way readiness does. */
export function createReadinessSignerFromPem(input: {
  privateKeyPem: string;
  publicKeyPem?: string;
  keyId?: string;
  keyVersion?: string;
}) {
  return createAsymmetricSigner(input);
}
