import { createHash } from "node:crypto";
import { getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";

const FLOW_TTL_MS = 30 * 60 * 1000;

export interface InstallFlowRecord {
  stateHash: string;
  sessionKey: string;
  repositoryFullName: string;
  owner: string;
  repo: string;
  scanId?: string;
  returnPath: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}

export interface RepoInstallBinding {
  sessionKey: string;
  installationId: number;
  installationOwner: string;
  installationOwnerType: string;
  repositoryFullName: string;
  setupAction?: "install" | "update";
  authorizedAt: string;
}

function flowKey(stateHash: string): string {
  return `flow:${stateHash}`;
}

function bindingKey(sessionKey: string, repositoryFullName: string): string {
  return `binding:${sessionKey}:${repositoryFullName}`;
}

function bindingKeyByInstallation(installationId: number, repositoryFullName: string): string {
  return `binding:install:${installationId}:${repositoryFullName}`;
}

function bindingKeyByBrowserId(browserSessionId: string, repositoryFullName: string): string {
  return `binding:browser-id:${browserSessionId}:${repositoryFullName}`;
}

export function hashInstallState(stateToken: string): string {
  return createHash("sha256").update(stateToken, "utf8").digest("hex");
}

export async function saveInstallFlow(record: InstallFlowRecord): Promise<void> {
  await setDurableRecord("github_installations", flowKey(record.stateHash), record);
}

export async function readInstallFlow(stateHash: string): Promise<InstallFlowRecord | undefined> {
  return getDurableRecord<InstallFlowRecord>("github_installations", flowKey(stateHash));
}

export async function markInstallFlowUsed(stateHash: string): Promise<void> {
  const existing = await readInstallFlow(stateHash);
  if (!existing) return;
  await setDurableRecord("github_installations", flowKey(stateHash), {
    ...existing,
    usedAt: new Date().toISOString(),
  });
}

export function isInstallFlowExpired(record: InstallFlowRecord, now = Date.now()): boolean {
  return Date.parse(record.expiresAt) <= now;
}

export function createInstallFlowRecord(input: {
  stateToken: string;
  sessionKey: string;
  repositoryFullName: string;
  owner: string;
  repo: string;
  scanId?: string;
  returnPath: string;
}): InstallFlowRecord {
  const now = Date.now();
  return {
    stateHash: hashInstallState(input.stateToken),
    sessionKey: input.sessionKey,
    repositoryFullName: input.repositoryFullName,
    owner: input.owner,
    repo: input.repo,
    scanId: input.scanId,
    returnPath: input.returnPath,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + FLOW_TTL_MS).toISOString(),
  };
}

function repoBindingIndexKey(repositoryFullName: string): string {
  return `binding:repo:${repositoryFullName}`;
}

export async function saveRepoInstallBinding(binding: RepoInstallBinding): Promise<void> {
  await setDurableRecord(
    "github_installations",
    bindingKey(binding.sessionKey, binding.repositoryFullName),
    binding
  );
  await setDurableRecord(
    "github_installations",
    bindingKeyByInstallation(binding.installationId, binding.repositoryFullName),
    binding
  );
  await setDurableRecord("github_installations", repoBindingIndexKey(binding.repositoryFullName), {
    installationId: binding.installationId,
    installationOwner: binding.installationOwner,
    authorizedAt: binding.authorizedAt,
  });
  const browserId = browserSessionFromKey(binding.sessionKey);
  if (browserId) {
    await setDurableRecord(
      "github_installations",
      bindingKeyByBrowserId(browserId, binding.repositoryFullName),
      binding
    );
  }
}

export async function readRepoInstallBinding(
  sessionKey: string,
  repositoryFullName: string
): Promise<RepoInstallBinding | undefined> {
  return getDurableRecord<RepoInstallBinding>(
    "github_installations",
    bindingKey(sessionKey, repositoryFullName)
  );
}

export function browserSessionFromKey(sessionKey?: string): string | undefined {
  if (!sessionKey) return undefined;
  if (sessionKey.startsWith("browser:")) return sessionKey.slice("browser:".length);
  const colon = sessionKey.lastIndexOf(":");
  return colon > 0 ? sessionKey.slice(colon + 1) : undefined;
}

export async function resolveRepoInstallBinding(input: {
  sessionKey?: string;
  installationId: number;
  repositoryFullName: string;
}): Promise<RepoInstallBinding | undefined> {
  const keysToTry = new Set<string>();
  if (input.sessionKey) keysToTry.add(input.sessionKey);
  const browserId = browserSessionFromKey(input.sessionKey);
  if (browserId) keysToTry.add(`browser:${browserId}`);

  for (const sessionKey of keysToTry) {
    const sessionBinding = await readRepoInstallBinding(sessionKey, input.repositoryFullName);
    if (sessionBinding && sessionBinding.installationId === input.installationId) {
      return sessionBinding;
    }
  }

  if (browserId) {
    const browserBinding = await getDurableRecord<RepoInstallBinding>(
      "github_installations",
      bindingKeyByBrowserId(browserId, input.repositoryFullName)
    );
    if (browserBinding && browserBinding.installationId === input.installationId) {
      return browserBinding;
    }
  }

  const installBinding = await getDurableRecord<RepoInstallBinding>(
    "github_installations",
    bindingKeyByInstallation(input.installationId, input.repositoryFullName)
  );
  if (installBinding && installBinding.installationId === input.installationId) {
    return installBinding;
  }
  return undefined;
}

export async function lookupRepositoryInstallationBinding(
  repositoryFullName: string
): Promise<{ installationId: number; installationOwner?: string; authorizedAt?: string } | undefined> {
  return getDurableRecord<{
    installationId: number;
    installationOwner?: string;
    authorizedAt?: string;
  }>("github_installations", repoBindingIndexKey(repositoryFullName));
}
