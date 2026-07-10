import {
  createInstallFlowRecord,
  hashInstallState,
  isInstallFlowExpired,
  markInstallFlowUsed,
  readInstallFlow,
  saveInstallFlow,
  type InstallFlowRecord,
} from "./install-flow-store";
import {
  clearPendingInstallCookie,
  readPendingInstallCookie,
  recordFromPendingInstall,
  savePendingInstallCookie,
} from "./install-flow-cookie";
import { parseRepositoryFullName } from "./repository";
import {
  createSignedInstallState,
  installFlowRecordFromSignedState,
  isSignedInstallStateToken,
  verifySignedInstallState,
} from "./install-signed-state";

export async function createInstallFlow(input: {
  sessionKey: string;
  repositoryFullName: string;
  scanId?: string;
  returnPath: string;
}): Promise<{ stateToken: string }> {
  const { owner, repo } = parseRepositoryFullName(input.repositoryFullName);
  const stateToken = createSignedInstallState({
    repositoryFullName: input.repositoryFullName,
    returnPath: input.returnPath,
    scanId: input.scanId,
  });
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
  await savePendingInstallCookie(record);
  return { stateToken };
}

async function resolveFromLegacyStores(
  stateToken: string
): Promise<InstallFlowRecord | null> {
  const stateHash = hashInstallState(stateToken);
  const record = await readInstallFlow(stateHash);
  if (record) return record;
  const pending = await readPendingInstallCookie();
  if (pending && hashInstallState(stateToken) === pending.stateHash) {
    return recordFromPendingInstall(pending);
  }
  return null;
}

export async function resolveInstallFlowState(
  stateToken: string,
  sessionKey?: string
): Promise<
  | { ok: true; record: InstallFlowRecord }
  | { ok: false; reason: "invalid" | "expired" | "reused" }
> {
  const signedPayload = verifySignedInstallState(stateToken);
  if (signedPayload) {
    const record = installFlowRecordFromSignedState(
      stateToken,
      signedPayload,
      sessionKey ?? "pending"
    );
    const durable = await readInstallFlow(record.stateHash);
    if (durable?.usedAt) return { ok: false, reason: "reused" };
    return { ok: true, record };
  }

  if (isSignedInstallStateToken(stateToken)) {
    return { ok: false, reason: "invalid" };
  }

  const record = await resolveFromLegacyStores(stateToken);
  if (!record) return { ok: false, reason: "invalid" };
  if (record.usedAt) return { ok: false, reason: "reused" };
  if (isInstallFlowExpired(record)) return { ok: false, reason: "expired" };
  return { ok: true, record };
}

export async function resolveInstallFlowFromPendingCookie(): Promise<InstallFlowRecord | null> {
  const pending = await readPendingInstallCookie();
  if (!pending) return null;
  const record = recordFromPendingInstall(pending);
  if (isInstallFlowExpired(record)) return null;
  return record;
}

export async function consumeInstallFlowState(stateToken: string): Promise<InstallFlowRecord | null> {
  const resolved = await resolveInstallFlowState(stateToken);
  if (!resolved.ok) return null;
  await markInstallFlowUsed(resolved.record.stateHash);
  await clearPendingInstallCookie();
  return resolved.record;
}
