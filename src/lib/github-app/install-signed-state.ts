import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getGitHubAppConfig, isGitHubAppConfigured } from "./config";
import {
  createInstallFlowRecord,
  hashInstallState,
  type InstallFlowRecord,
} from "./install-flow-store";
import { parseRepositoryFullName } from "./repository";

const FLOW_TTL_MS = 30 * 60 * 1000;
const STATE_VERSION = 2;

interface CompactSignedInstallStatePayload {
  v: typeof STATE_VERSION;
  rf: string;
  rp: string;
  s?: string;
  exp: number;
  n: string;
}

function signingSecret(): string {
  const { clientSecret } = getGitHubAppConfig();
  return clientSecret;
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", signingSecret()).update(encodedPayload, "utf8").digest("base64url");
}

function splitSignedToken(stateToken: string): { encoded: string; signature: string } | null {
  const dot = stateToken.lastIndexOf(".");
  if (dot <= 0 || dot === stateToken.length - 1) return null;
  return {
    encoded: stateToken.slice(0, dot),
    signature: stateToken.slice(dot + 1),
  };
}

function verifySignature(encodedPayload: string, signature: string): boolean {
  const expected = sign(encodedPayload);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return timingSafeEqual(sigBuf, expBuf);
}

function decodeLegacyPayload(encoded: string): CompactSignedInstallStatePayload | null {
  try {
    const raw = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;

    if (raw.v === 2 && typeof raw.rf === "string" && typeof raw.rp === "string") {
      return {
        v: STATE_VERSION,
        rf: raw.rf,
        rp: raw.rp,
        s: typeof raw.s === "string" ? raw.s : undefined,
        exp: Number(raw.exp),
        n: typeof raw.n === "string" ? raw.n : "legacy",
      };
    }

    if (raw.v === 1 && typeof raw.repositoryFullName === "string") {
      return {
        v: STATE_VERSION,
        rf: raw.repositoryFullName,
        rp: String(raw.returnPath ?? "/app?tab=patch"),
        s: typeof raw.scanId === "string" ? raw.scanId : undefined,
        exp: Number(raw.exp),
        n: typeof raw.nonce === "string" ? raw.nonce : "legacy",
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function createSignedInstallState(input: {
  repositoryFullName: string;
  returnPath: string;
  scanId?: string;
  ttlMs?: number;
}): string {
  if (!isGitHubAppConfigured()) {
    throw new Error("GitHub App is not configured.");
  }

  const payload: CompactSignedInstallStatePayload = {
    v: STATE_VERSION,
    rf: input.repositoryFullName,
    rp: input.returnPath,
    s: input.scanId,
    exp: Date.now() + (input.ttlMs ?? FLOW_TTL_MS),
    n: randomBytes(12).toString("base64url"),
  };

  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifySignedInstallState(
  stateToken: string
): CompactSignedInstallStatePayload | null {
  if (!isGitHubAppConfigured()) return null;

  const parts = splitSignedToken(stateToken);
  if (!parts) return null;
  if (!verifySignature(parts.encoded, parts.signature)) return null;

  const payload = decodeLegacyPayload(parts.encoded);
  if (!payload) return null;
  if (payload.v !== STATE_VERSION && payload.v !== 1) return null;
  if (!payload.rf || !payload.rp) return null;
  if (!payload.exp || Date.now() > payload.exp) return null;

  try {
    parseRepositoryFullName(payload.rf);
  } catch {
    return null;
  }

  return payload;
}

export function installFlowRecordFromSignedState(
  stateToken: string,
  payload: CompactSignedInstallStatePayload,
  sessionKey: string
): InstallFlowRecord {
  const { owner, repo } = parseRepositoryFullName(payload.rf);
  return createInstallFlowRecord({
    stateToken,
    sessionKey,
    repositoryFullName: payload.rf,
    owner,
    repo,
    scanId: payload.s,
    returnPath: payload.rp,
  });
}

export function isSignedInstallStateToken(stateToken: string): boolean {
  const parts = splitSignedToken(stateToken);
  return Boolean(parts && parts.encoded.length > 20 && parts.signature.length > 10);
}

export function signedStateHash(stateToken: string): string {
  return hashInstallState(stateToken);
}
