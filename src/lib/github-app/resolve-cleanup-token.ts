import { ToolExecutionError } from "@/lib/a2mcp/errors";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import {
  createInstallationAccessToken,
  installationHasRepoAccess,
} from "@/lib/github-app/installations";
import { isGitHubAppConfigured } from "@/lib/github-app/config";
import { readInstallationSession } from "@/lib/github-app/session";

export async function resolveCleanupGitHubToken(opts: {
  demo?: boolean;
  repoUrl: string;
  owner: string;
  repo: string;
  githubToken?: string;
}): Promise<string> {
  if (opts.demo) {
    if (!isDemoRepoUrl(opts.repoUrl)) {
      throw new ToolExecutionError(
        "DEMO_REPO_ONLY",
        "Demo mode only works with the configured demo repository.",
        403
      );
    }
    const token = process.env.GITHUB_DEMO_TOKEN?.trim();
    if (!token) {
      throw new ToolExecutionError(
        "INTERNAL_ERROR",
        "Demo GitHub token is not configured on the server.",
        500
      );
    }
    return token;
  }

  if (opts.githubToken?.trim()) {
    return opts.githubToken.trim();
  }

  if (isGitHubAppConfigured()) {
    const session = await readInstallationSession();
    if (session) {
      const hasAccess = await installationHasRepoAccess(
        session.installationId,
        opts.owner,
        opts.repo
      );
      if (!hasAccess) {
        throw new ToolExecutionError(
          "GITHUB_PERMISSION_DENIED",
          "The connected GitHub App installation does not have access to this repository. Install RepoDiet on this repo and try again.",
          403
        );
      }
      const installationToken = await createInstallationAccessToken(session.installationId);
      return installationToken.token;
    }
  }

  throw new ToolExecutionError(
    "MISSING_GITHUB_TOKEN",
    "Install the RepoDiet GitHub App on this repository, or use advanced manual token mode.",
    401
  );
}
