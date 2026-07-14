import {
  fetchInstallationSession,
  installationIncludesRepositoryWithRetry,
} from "@/lib/github-app/installations";
import { saveRepoInstallBinding } from "@/lib/github-app/install-flow-store";
import { saveInstallationSession } from "@/lib/github-app/session";
import { parseRepositoryFullName } from "@/lib/github-app/repository";
import { runGitHubPreflight, type GitHubPreflightInput } from "@/lib/github-app/preflight";
import { saveAspRepositoryInstallation } from "@/lib/asp/store";

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
  aspPersisted: boolean;
}

export async function completeInstallAccess(
  input: CompleteInstallAccessInput
): Promise<CompleteInstallAccessResult> {
  const { owner, repo } = parseRepositoryFullName(input.repositoryFullName);
  const session = await fetchInstallationSession(input.installationId);
  await saveInstallationSession(session);

  const trustGrant =
    input.trustPendingPropagation === true || input.setupAction === "update";
  const attempts = input.quick ? 2 : trustGrant ? 6 : 4;
  const delayMs = input.quick ? 400 : 1500;

  const access = await installationIncludesRepositoryWithRetry(
    input.installationId,
    owner,
    repo,
    { attempts, delayMs }
  );

  const authorizedAt = new Date().toISOString();
  await saveRepoInstallBinding({
    sessionKey: input.sessionKey,
    installationId: session.installationId,
    installationOwner: session.accountLogin,
    installationOwnerType: session.accountType,
    repositoryFullName: input.repositoryFullName,
    setupAction: input.setupAction,
    authorizedAt,
  });

  let aspPersisted = false;
  if (access.granted) {
    await saveAspRepositoryInstallation({
      installationId: session.installationId,
      repositoryFullName: input.repositoryFullName,
      authorizedAt,
    });
    aspPersisted = true;
  }

  return {
    session,
    repositoryAccessible: access.granted,
    accessibleRepos: access.accessibleRepos,
    bindingSaved: true,
    aspPersisted,
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
  /** Fast path for background polls; explicit user sync uses full retries. */
  quick?: boolean;
}) {
  const quick = input.quick === true;
  const completed = await completeInstallAccess({
    installationId: input.installationId!,
    repositoryFullName: input.repositoryFullName,
    sessionKey: input.sessionKey,
    setupAction: input.setupAction,
    trustPendingPropagation: input.trustPendingPropagation,
    quick,
  });

  const preflight = await runGitHubPreflight({
    repositoryFullName: input.repositoryFullName,
    sessionKey: input.sessionKey,
    branch: input.branch,
    scanId: input.scanId,
    commitSha: input.commitSha,
    quick,
  } satisfies GitHubPreflightInput);

  if (preflight.repositoryAuthorized) {
    await saveAspRepositoryInstallation({
      installationId: completed.session.installationId,
      repositoryFullName: input.repositoryFullName,
      authorizedAt: new Date().toISOString(),
    });
  }

  return { completed, preflight };
}
