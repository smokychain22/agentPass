import {
  fetchInstallationSession,
  installationIncludesRepositoryWithRetry,
} from "@/lib/github-app/installations";
import { saveRepoInstallBinding } from "@/lib/github-app/install-flow-store";
import { saveInstallationSession } from "@/lib/github-app/session";
import { parseRepositoryFullName } from "@/lib/github-app/repository";

export interface CompleteInstallAccessInput {
  installationId: number;
  repositoryFullName: string;
  sessionKey: string;
  setupAction?: "install" | "update";
  trustPendingPropagation?: boolean;
}

export interface CompleteInstallAccessResult {
  session: Awaited<ReturnType<typeof fetchInstallationSession>>;
  repositoryAccessible: boolean;
  accessibleRepos: string[];
}

export async function completeInstallAccess(
  input: CompleteInstallAccessInput
): Promise<CompleteInstallAccessResult> {
  const { owner, repo } = parseRepositoryFullName(input.repositoryFullName);
  const session = await fetchInstallationSession(input.installationId);
  await saveInstallationSession(session);

  const attempts = input.trustPendingPropagation || input.setupAction === "update" ? 8 : 5;
  const access = await installationIncludesRepositoryWithRetry(
    input.installationId,
    owner,
    repo,
    { attempts, delayMs: 1500 }
  );

  if (access.granted || input.trustPendingPropagation || input.setupAction === "update") {
    await saveRepoInstallBinding({
      sessionKey: input.sessionKey,
      installationId: session.installationId,
      installationOwner: session.accountLogin,
      installationOwnerType: session.accountType,
      repositoryFullName: input.repositoryFullName,
      setupAction: input.setupAction,
      authorizedAt: new Date().toISOString(),
    });
  }

  return {
    session,
    repositoryAccessible: access.granted,
    accessibleRepos: access.accessibleRepos,
  };
}
