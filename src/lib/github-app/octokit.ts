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

export function getAppOctokit(): Octokit {
  if (!appOctokit) {
    const auth = buildAppAuth();
    appOctokit = new Octokit({ auth });
  }
  return appOctokit;
}

export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  const auth = buildAppAuth();
  return new Octokit({
    auth: await auth({ type: "installation", installationId }),
  });
}
