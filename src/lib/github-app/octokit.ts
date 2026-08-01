import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { getGitHubAppConfig } from "./config";

let appOctokit: Octokit | null = null;

function buildAppAuth() {
  const { appId, privateKey, clientId, clientSecret } = getGitHubAppConfig();
  return createAppAuth({
    appId,
    privateKey,
    clientId,
    clientSecret,
  });
}

/**
 * === Incident #15: app-level requests were never authenticated ===
 *
 * `new Octokit({ auth })` was being handed the auth STRATEGY returned by
 * `createAppAuth(...)`, not a token and not strategy options. Per
 * @octokit/auth-app's own README, authenticating as the App requires
 * `authStrategy: createAppAuth` together with `auth: { appId, privateKey,
 * ... }`. Without `authStrategy`, Octokit does not invoke the strategy, so
 * every app-level request went out effectively unauthenticated and GitHub
 * rejected it.
 *
 * The only caller is `paginateInstallationForRepository`, whose
 * `apps.listInstallations` call therefore always threw — and its bare
 * `catch` turned that into "no installation found". Net effect: repository
 * access discovery reported `accessState: "not_installed"` for a
 * repository that was genuinely installed and fully authorized.
 *
 * Proven live against production: resolving the same repository while
 * passing the known installation id explicitly (which bypasses this scan
 * and uses the raw-JWT path in installations.ts) returned
 * `authoritativeState: "repository_verified"`, `installationFound: true`,
 * `repositorySelected: true`, contents/pullRequests `write`, and a
 * successfully minted installation token — same App id, same repository,
 * same credentials. Only the discovery path failed.
 *
 * `getInstallationOctokit` below is deliberately left as-is: installation-
 * scoped calls are demonstrably working in production, and changing a
 * working auth path on the same evidence would be speculative.
 */
export function getAppOctokit(): Octokit {
  if (!appOctokit) {
    const { appId, privateKey, clientId, clientSecret } = getGitHubAppConfig();
    appOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: { appId, privateKey, clientId, clientSecret },
    });
  }
  return appOctokit;
}

export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  const auth = buildAppAuth();
  return new Octokit({
    auth: await auth({ type: "installation", installationId }),
  });
}
