import { randomBytes } from "node:crypto";
import { getGitHubAppInstallUrl } from "./config";
import {
  createInstallFlowRecord,
  hashInstallState,
  isInstallFlowExpired,
  markInstallFlowUsed,
  readInstallFlow,
  saveInstallFlow,
  type InstallFlowRecord,
} from "./install-flow-store";
import { parseRepositoryFullName } from "./repository";

export function generateInstallStateToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createInstallFlow(input: {
  sessionKey: string;
  repositoryFullName: string;
  scanId?: string;
  returnPath: string;
}): Promise<{ stateToken: string; installUrl: string }> {
  const { owner, repo } = parseRepositoryFullName(input.repositoryFullName);
  const stateToken = generateInstallStateToken();
  const record = createInstallFlowRecord({
    stateToken,
    sessionKey: input.sessionKey,
    repositoryFullName: input.repositoryFullName,
    owner,
    repo,
    scanId: input.scanId,
    returnPath: input.returnPath,
  });
  await saveInstallFlow(record);
  const installUrl = getGitHubAppInstallUrl(stateToken);
  assertPublicGitHubInstallUrl(installUrl);
  return {
    stateToken,
    installUrl,
  };
}

export function assertPublicGitHubInstallUrl(url: string): void {
  if (url.includes("github.com/settings/apps")) {
    throw new Error("Install URL must not use GitHub developer settings.");
  }
  if (!url.includes("/installations/new")) {
    throw new Error("Install URL must use the public GitHub App installation flow.");
  }
}

export async function resolveInstallFlowState(
  stateToken: string
): Promise<
  | { ok: true; record: InstallFlowRecord }
  | { ok: false; reason: "invalid" | "expired" | "reused" }
> {
  const stateHash = hashInstallState(stateToken);
  const record = await readInstallFlow(stateHash);
  if (!record) return { ok: false, reason: "invalid" };
  if (record.usedAt) return { ok: false, reason: "reused" };
  if (isInstallFlowExpired(record)) return { ok: false, reason: "expired" };
  return { ok: true, record };
}

export async function consumeInstallFlowState(stateToken: string): Promise<InstallFlowRecord | null> {
  const resolved = await resolveInstallFlowState(stateToken);
  if (!resolved.ok) return null;
  await markInstallFlowUsed(resolved.record.stateHash);
  return resolved.record;
}
