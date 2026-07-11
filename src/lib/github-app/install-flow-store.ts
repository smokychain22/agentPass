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

export async function resolveRepoInstallBinding(input: {
  sessionKey?: string;
  installationId: number;
  repositoryFullName: string;
}): Promise<RepoInstallBinding | undefined> {
  if (input.sessionKey) {
    const sessionBinding = await readRepoInstallBinding(
      input.sessionKey,
      input.repositoryFullName
    );
    if (
      sessionBinding &&
      sessionBinding.installationId === input.installationId
    ) {
      return sessionBinding;
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
