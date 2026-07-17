import fs from "node:fs";
import path from "node:path";
import { createPrivateKey, createPublicKey, createSign, createVerify } from "node:crypto";
import jwt from "jsonwebtoken";
import {
  createAsymmetricSigner,
  publicKeyFingerprint,
  signCanonicalPayload,
  verifyCanonicalPayload,
} from "@/lib/green-pr/signatures";
import {
  decodePrivateKeyMaterial,
  EXPECTED_GITHUB_APP_NAME,
  EXPECTED_GITHUB_APP_SLUG,
  readGitHubAppId,
  readGitHubAppPrivateKeyRaw,
  readGitHubAppSlug,
  readGreenPrAttestationPrivateKeyRaw,
  readGreenPrReceiptPrivateKeyRaw,
  readOperatorReceiptPrivateKeyRaw,
} from "@/lib/delivery/env-keys";

export type GitHubAppReadinessReason =
  | "GITHUB_APP_ID_MISSING"
  | "GITHUB_APP_PRIVATE_KEY_MISSING"
  | "GITHUB_APP_PRIVATE_KEY_INVALID"
  | "GITHUB_APP_AUTH_FAILED"
  | "GITHUB_APP_IDENTITY_MISMATCH"
  | "GITHUB_APP_REQUIRED_PERMISSION_MISSING"
  | "GITHUB_APP_INSTALLATION_NOT_FOUND"
  | "GITHUB_APP_INSTALLATION_TOKEN_FAILED"
  | "GITHUB_APP_DISPATCH_PAT_IN_DELIVERY_PATH";

export type ReceiptSignerReadinessReason =
  | "OPERATOR_RECEIPT_SIGNING_KEY_MISSING"
  | "OPERATOR_RECEIPT_SIGNING_KEY_INVALID"
  | "OPERATOR_RECEIPT_SIGNING_SELF_TEST_FAILED"
  | "GREEN_PR_RECEIPT_SIGNING_KEY_MISSING"
  | "GREEN_PR_RECEIPT_SIGNING_KEY_INVALID"
  | "GREEN_PR_RECEIPT_SIGNING_SELF_TEST_FAILED"
  | "RECEIPT_ATTESTATION_SIGNING_IDENTITY_COLLISION";

export type AttestationSignerReadinessReason =
  | "ATTESTATION_SIGNING_KEY_MISSING"
  | "ATTESTATION_SIGNING_KEY_INVALID"
  | "ATTESTATION_SIGNING_SELF_TEST_FAILED"
  | "ATTESTATION_RECEIPT_SIGNING_IDENTITY_COLLISION";

export interface GitHubAppReadinessProbe {
  ready: boolean;
  reasons: GitHubAppReadinessReason[];
  checkedAt: string;
  appId?: string;
  appSlug?: string;
  appName?: string;
  installationCount?: number;
}

export interface ReceiptSignerReadinessProbe {
  ready: boolean;
  reasons: ReceiptSignerReadinessReason[];
  checkedAt: string;
  keyIds?: string[];
}

export interface AttestationSignerReadinessProbe {
  ready: boolean;
  reasons: AttestationSignerReadinessReason[];
  checkedAt: string;
  keyIds?: string[];
}

export interface DeliveryReadinessSnapshot {
  githubAppReady: boolean;
  receiptSignerReady: boolean;
  attestationSignerReady: boolean;
  githubApp: GitHubAppReadinessProbe;
  receiptSigner: ReceiptSignerReadinessProbe;
  attestationSigner: AttestationSignerReadinessProbe;
  checkedAt: string;
}

const GITHUB_API_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
} as const;

const REQUIRED_APP_PERMISSIONS = {
  metadata: "read",
  contents: "write",
  pull_requests: "write",
} as const;

const FORBIDDEN_APP_PERMISSION_WRITES = [
  "administration",
  "organization_administration",
  "secrets",
] as const;

const READINESS_PROBE_PAYLOAD = {
  component: "repodiet-delivery-readiness",
  version: 1,
} as const;

function checkedAt(): string {
  return new Date().toISOString();
}

function parsePrivateKeyPem(raw: string): string {
  const pem = decodePrivateKeyMaterial(raw);
  createPrivateKey(pem);
  return pem;
}

function probeRsaSigner(raw: string): { ok: true; keyId: string } | { ok: false; reason: "invalid" | "self_test_failed" } {
  try {
    const pem = parsePrivateKeyPem(raw);
    const signer = createSign("SHA256");
    signer.update(JSON.stringify(READINESS_PROBE_PAYLOAD));
    signer.end();
    const signature = signer.sign(pem, "base64");
    const publicPem = createPublicKey(createPrivateKey(pem))
      .export({ type: "spki", format: "pem" })
      .toString();
    const verifier = createVerify("SHA256");
    verifier.update(JSON.stringify(READINESS_PROBE_PAYLOAD));
    verifier.end();
    if (!verifier.verify(publicPem, signature, "base64")) {
      return { ok: false, reason: "self_test_failed" };
    }
    return { ok: true, keyId: `sha256:${publicKeyFingerprint(publicPem)}` };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

function probeGreenPrSigner(raw: string): { ok: true; keyId: string } | { ok: false; reason: "invalid" | "self_test_failed" } {
  try {
    const signer = createAsymmetricSigner({ privateKeyPem: raw });
    const signature = signCanonicalPayload(READINESS_PROBE_PAYLOAD, signer);
    if (!verifyCanonicalPayload(READINESS_PROBE_PAYLOAD, signature, signer.publicKeyPem)) {
      return { ok: false, reason: "self_test_failed" };
    }
    return { ok: true, keyId: signer.keyId };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

function createGitHubAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId,
    },
    privateKeyPem,
    { algorithm: "RS256" }
  );
}

function permissionsSatisfied(
  permissions: Record<string, string> | undefined
): boolean {
  if (!permissions) return false;
  for (const [name, level] of Object.entries(REQUIRED_APP_PERMISSIONS)) {
    const actual = permissions[name];
    if (!actual) return false;
    if (level === "read" && actual !== "read" && actual !== "write") return false;
    if (level === "write" && actual !== "write") return false;
  }
  return true;
}

function hasForbiddenWritePermissions(permissions: Record<string, string> | undefined): boolean {
  if (!permissions) return false;
  return FORBIDDEN_APP_PERMISSION_WRITES.some(
    (name) => permissions[name] === "write" || permissions[name] === "admin"
  );
}

const DELIVERY_SOURCE_PATHS = [
  "src/lib/operator/create-cleanup-pr.ts",
  "src/lib/github-app/resolve-cleanup-token.ts",
  "src/lib/asp/github-access.ts",
  "src/lib/asp/executor.ts",
  "src/lib/a2a/orchestrator.ts",
] as const;

/** Static guard: customer delivery must never import the internal Actions dispatch PAT. */
export function deliveryUsesActionsDispatchPat(repoRoot = process.cwd()): boolean {
  return DELIVERY_SOURCE_PATHS.some((relativePath) => {
    try {
      const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
      return /REPODIET_ACTIONS_DISPATCH_TOKEN/.test(source);
    } catch {
      return false;
    }
  });
}

export async function probeGitHubAppReadiness(): Promise<GitHubAppReadinessProbe> {
  const at = checkedAt();
  const reasons: GitHubAppReadinessReason[] = [];

  if (deliveryUsesActionsDispatchPat()) {
    reasons.push("GITHUB_APP_DISPATCH_PAT_IN_DELIVERY_PATH");
  }

  const appId = readGitHubAppId();
  if (!appId) {
    reasons.push("GITHUB_APP_ID_MISSING");
    return { ready: false, reasons, checkedAt: at };
  }

  const privateKeyRaw = readGitHubAppPrivateKeyRaw();
  if (!privateKeyRaw) {
    reasons.push("GITHUB_APP_PRIVATE_KEY_MISSING");
    return { ready: false, reasons, checkedAt: at, appId };
  }

  let privateKeyPem: string;
  try {
    privateKeyPem = parsePrivateKeyPem(privateKeyRaw);
  } catch {
    reasons.push("GITHUB_APP_PRIVATE_KEY_INVALID");
    return { ready: false, reasons, checkedAt: at, appId };
  }

  let appJwt: string;
  try {
    appJwt = createGitHubAppJwt(appId, privateKeyPem);
  } catch {
    reasons.push("GITHUB_APP_PRIVATE_KEY_INVALID");
    return { ready: false, reasons, checkedAt: at, appId };
  }

  let appMetadata: {
    slug?: string;
    name?: string;
    permissions?: Record<string, string>;
  };
  try {
    const res = await fetch("https://api.github.com/app", {
      headers: {
        ...GITHUB_API_HEADERS,
        Authorization: `Bearer ${appJwt}`,
      },
    });
    if (!res.ok) {
      reasons.push("GITHUB_APP_AUTH_FAILED");
      return { ready: false, reasons, checkedAt: at, appId };
    }
    appMetadata = (await res.json()) as typeof appMetadata;
  } catch {
    reasons.push("GITHUB_APP_AUTH_FAILED");
    return { ready: false, reasons, checkedAt: at, appId };
  }

  const configuredSlug = readGitHubAppSlug() ?? EXPECTED_GITHUB_APP_SLUG;
  const appSlug = appMetadata.slug ?? "";
  const appName = appMetadata.name ?? "";
  const slugMatches =
    appSlug.toLowerCase() === configuredSlug.toLowerCase() ||
    appSlug.toLowerCase() === EXPECTED_GITHUB_APP_SLUG;
  const nameMatches = appName.toLowerCase().includes(EXPECTED_GITHUB_APP_NAME.toLowerCase());
  if (!slugMatches || !nameMatches) {
    reasons.push("GITHUB_APP_IDENTITY_MISMATCH");
  }

  if (
    !permissionsSatisfied(appMetadata.permissions) ||
    hasForbiddenWritePermissions(appMetadata.permissions)
  ) {
    reasons.push("GITHUB_APP_REQUIRED_PERMISSION_MISSING");
  }

  let installationCount = 0;
  try {
    const res = await fetch("https://api.github.com/app/installations?per_page=1", {
      headers: {
        ...GITHUB_API_HEADERS,
        Authorization: `Bearer ${appJwt}`,
      },
    });
    if (!res.ok) {
      reasons.push("GITHUB_APP_AUTH_FAILED");
      return {
        ready: false,
        reasons,
        checkedAt: at,
        appId,
        appSlug,
        appName,
      };
    }
    const installations = (await res.json()) as Array<{ id: number }>;
    installationCount = installations.length;
    if (installationCount === 0) {
      reasons.push("GITHUB_APP_INSTALLATION_NOT_FOUND");
      return {
        ready: false,
        reasons,
        checkedAt: at,
        appId,
        appSlug,
        appName,
        installationCount,
      };
    }

    const installationId = installations[0]!.id;
    const tokenRes = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          ...GITHUB_API_HEADERS,
          Authorization: `Bearer ${appJwt}`,
        },
      }
    );
    if (!tokenRes.ok) {
      reasons.push("GITHUB_APP_INSTALLATION_TOKEN_FAILED");
    }
  } catch {
    reasons.push("GITHUB_APP_INSTALLATION_TOKEN_FAILED");
  }

  return {
    ready: reasons.length === 0,
    reasons,
    checkedAt: at,
    appId,
    appSlug,
    appName,
    installationCount,
  };
}

export function probeReceiptSignerReadiness(): ReceiptSignerReadinessProbe {
  const at = checkedAt();
  const reasons: ReceiptSignerReadinessReason[] = [];
  const keyIds: string[] = [];

  const operatorRaw = readOperatorReceiptPrivateKeyRaw();
  if (!operatorRaw) {
    reasons.push("OPERATOR_RECEIPT_SIGNING_KEY_MISSING");
  } else {
    const operatorProbe = probeRsaSigner(operatorRaw);
    if (operatorProbe.ok === false) {
      reasons.push(
        operatorProbe.reason === "invalid"
          ? "OPERATOR_RECEIPT_SIGNING_KEY_INVALID"
          : "OPERATOR_RECEIPT_SIGNING_SELF_TEST_FAILED"
      );
    } else {
      keyIds.push(operatorProbe.keyId);
    }
  }

  const greenPrReceiptRaw = readGreenPrReceiptPrivateKeyRaw();
  if (!greenPrReceiptRaw) {
    reasons.push("GREEN_PR_RECEIPT_SIGNING_KEY_MISSING");
  } else {
    const greenProbe = probeGreenPrSigner(greenPrReceiptRaw);
    if (greenProbe.ok === false) {
      reasons.push(
        greenProbe.reason === "invalid"
          ? "GREEN_PR_RECEIPT_SIGNING_KEY_INVALID"
          : "GREEN_PR_RECEIPT_SIGNING_SELF_TEST_FAILED"
      );
    } else {
      keyIds.push(greenProbe.keyId);
    }
  }

  if (keyIds.length === 2 && keyIds[0] === keyIds[1]) {
    reasons.push("RECEIPT_ATTESTATION_SIGNING_IDENTITY_COLLISION");
  }

  return {
    ready: reasons.length === 0,
    reasons,
    checkedAt: at,
    keyIds: keyIds.length ? keyIds : undefined,
  };
}

export function probeAttestationSignerReadiness(
  receiptKeyIds: string[] = []
): AttestationSignerReadinessProbe {
  const at = checkedAt();
  const reasons: AttestationSignerReadinessReason[] = [];
  const keyIds: string[] = [];

  const attestationRaw = readGreenPrAttestationPrivateKeyRaw();
  if (!attestationRaw) {
    reasons.push("ATTESTATION_SIGNING_KEY_MISSING");
    return { ready: false, reasons, checkedAt: at };
  }

  const attestationProbe = probeGreenPrSigner(attestationRaw);
  if (attestationProbe.ok === false) {
    reasons.push(
      attestationProbe.reason === "invalid"
        ? "ATTESTATION_SIGNING_KEY_INVALID"
        : "ATTESTATION_SIGNING_SELF_TEST_FAILED"
    );
    return { ready: false, reasons, checkedAt: at };
  }

  keyIds.push(attestationProbe.keyId);
  if (receiptKeyIds.includes(attestationProbe.keyId)) {
    reasons.push("ATTESTATION_RECEIPT_SIGNING_IDENTITY_COLLISION");
  }

  return {
    ready: reasons.length === 0,
    reasons,
    checkedAt: at,
    keyIds,
  };
}

export async function probeDeliveryReadiness(): Promise<DeliveryReadinessSnapshot> {
  const [githubApp, receiptSigner] = await Promise.all([
    probeGitHubAppReadiness(),
    Promise.resolve(probeReceiptSignerReadiness()),
  ]);
  const attestationSigner = probeAttestationSignerReadiness(receiptSigner.keyIds ?? []);
  return {
    githubAppReady: githubApp.ready,
    receiptSignerReady: receiptSigner.ready,
    attestationSignerReady: attestationSigner.ready,
    githubApp,
    receiptSigner,
    attestationSigner,
    checkedAt: checkedAt(),
  };
}
