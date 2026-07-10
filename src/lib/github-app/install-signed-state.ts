import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getGitHubAppConfig, isGitHubAppConfigured } from "./config";
import {
  createInstallFlowRecord,
  hashInstallState,
  type InstallFlowRecord,
} from "./install-flow-store";

const FLOW_TTL_MS = 30 * 60 * 1000;
const STATE_VERSION = 1;

export interface SignedInstallStatePayload {
  v: typeof STATE_VERSION;
  owner: string;
  repo: string;
  repositoryFullName: string;
  returnPath: string;
  scanId?: string;
  sessionKey: string;
  exp: number;
  nonce: string;
}

function signingSecret(): string {
  const { clientSecret } = getGitHubAppConfig();
  return clientSecret;
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", signingSecret()).update(encodedPayload, "utf8").digest("base64url");
}

function verifySignature(encodedPayload: string, signature: string): boolean {
  const expected = sign(encodedPayload);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return timingSafeEqual(sigBuf, expBuf);
}

export function createSignedInstallState(input: {
  sessionKey: string;
  repositoryFullName: string;
  owner: string;
  repo: string;
  scanId?: string;
  returnPath: string;
  ttlMs?: number;
}): string {
  if (!isGitHubAppConfigured()) {
    throw new Error("GitHub App is not configured.");
  }

  const payload: SignedInstallStatePayload = {
    v: STATE_VERSION,
    owner: input.owner,
    repo: input.repo,
    repositoryFullName: input.repositoryFullName,
    returnPath: input.returnPath,
    scanId: input.scanId,
    sessionKey: input.sessionKey,
    exp: Date.now() + (input.ttlMs ?? FLOW_TTL_MS),
    nonce: randomBytes(16).toString("base64url"),
  };

  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifySignedInstallState(
  stateToken: string
): SignedInstallStatePayload | null {
  if (!isGitHubAppConfigured()) return null;

  const [encoded, signature] = stateToken.split(".");
  if (!encoded || !signature) return null;
  if (!verifySignature(encoded, signature)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as SignedInstallStatePayload;

    if (payload.v !== STATE_VERSION) return null;
    if (!payload.owner || !payload.repo || !payload.repositoryFullName) return null;
    if (!payload.returnPath || !payload.sessionKey) return null;
    if (!payload.exp || Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

export function installFlowRecordFromSignedState(
  stateToken: string,
  payload: SignedInstallStatePayload
): InstallFlowRecord {
  return createInstallFlowRecord({
    stateToken,
    sessionKey: payload.sessionKey,
    repositoryFullName: payload.repositoryFullName,
    owner: payload.owner,
    repo: payload.repo,
    scanId: payload.scanId,
    returnPath: payload.returnPath,
  });
}

export function isSignedInstallStateToken(stateToken: string): boolean {
  const [encoded, signature] = stateToken.split(".");
  return Boolean(encoded && signature && encoded.length > 20);
}

export function signedStateHash(stateToken: string): string {
  return hashInstallState(stateToken);
}
