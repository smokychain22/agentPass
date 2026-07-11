import {
  fetchInstallationSession,
  installationIncludesRepositoryWithRetry,
} from "@/lib/github-app/installations";
import { saveRepoInstallBinding } from "@/lib/github-app/install-flow-store";
import { saveInstallationSession } from "@/lib/github-app/session";
import { parseRepositoryFullName } from "@/lib/github-app/repository";
import { runGitHubPreflight, type GitHubPreflightInput } from "@/lib/github-app/preflight";

export interface CompleteInstallAccessInput {
  installationId: number;
  repositoryFullName: string;
  sessionKey: string;
  setupAction?: "install" | "update";
  trustPendingPropagation?: boolean;
  quick?: boolean;
}

export interface CompleteInstallAccessResult {
  session: Awaited<ReturnType<typeof fetchInstallationSession>>;
  repositoryAccessible: boolean;
  accessibleRepos: string[];
  bindingSaved: boolean;
}

export async function completeInstallAccess(
  input: CompleteInstallAccessInput
): Promise<CompleteInstallAccessResult> {
  const { owner, repo } = parseRepositoryFullName(input.repositoryFullName);
  const session = await fetchInstallationSession(input.installationId);
  await saveInstallationSession(session);

  const trustGrant =
    input.trustPendingPropagation || input.setupAction === "update" || input.quick;
  const attempts = input.quick ? 2 : trustGrant ? 4 : 3;
  const delayMs = input.quick ? 400 : 1000;

  const access = await installationIncludesRepositoryWithRetry(
    input.installationId,
    owner,
    repo,
    { attempts, delayMs }
  );

  let bindingSaved = false;
  if (access.granted || trustGrant) {
    await saveRepoInstallBinding({
      sessionKey: input.sessionKey,
      installationId: session.installationId,
      installationOwner: session.accountLogin,
      installationOwnerType: session.accountType,
      repositoryFullName: input.repositoryFullName,
      setupAction: input.setupAction,
      authorizedAt: new Date().toISOString(),
    });
    bindingSaved = true;
  }

  return {
    session,
    repositoryAccessible: access.granted,
    accessibleRepos: access.accessibleRepos,
    bindingSaved,
  };
}

export async function runGitHubAccessSync(input: {
  repositoryFullName: string;
  sessionKey: string;
  installationId?: number;
  setupAction?: "install" | "update";
  trustPendingPropagation?: boolean;
  branch?: string;
  scanId?: string;
  commitSha?: string;
}) {
  const completed = await completeInstallAccess({
    installationId: input.installationId!,
    repositoryFullName: input.repositoryFullName,
    sessionKey: input.sessionKey,
    setupAction: input.setupAction,
    trustPendingPropagation: input.trustPendingPropagation,
    quick: true,
  });

  const preflight = await runGitHubPreflight({
    repositoryFullName: input.repositoryFullName,
    sessionKey: input.sessionKey,
    branch: input.branch,
    scanId: input.scanId,
    commitSha: input.commitSha,
    quick: true,
  } satisfies GitHubPreflightInput);

  return { completed, preflight };
}
