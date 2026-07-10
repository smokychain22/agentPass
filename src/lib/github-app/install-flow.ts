import { randomBytes } from "node:crypto";
import { getGitHubAppConfig, getGitHubAppInstallUrl } from "./config";
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
  return {
    stateToken,
    installUrl: getGitHubAppInstallUrl(stateToken),
  };
}

export function getConfigureInstallationUrl(installationId: number, state?: string): string {
  const { slug } = getGitHubAppConfig();
  const base = `https://github.com/apps/${slug}/installations/${installationId}`;
  if (!state) return base;
  return `${base}?state=${encodeURIComponent(state)}`;
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
