import { parseGitHubUrl } from "@/lib/github/parse-github-url";

export function parseRepositoryFullName(repositoryFullName: string): {
  owner: string;
  repo: string;
} {
  const trimmed = repositoryFullName.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    throw new Error("repositoryFullName must be in owner/repo format.");
  }
  return {
    owner: trimmed.slice(0, slash),
    repo: trimmed.slice(slash + 1),
  };
}

export function repositoryFullNameFromUrl(repoUrl: string): string | null {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) return null;
  return `${parsed.owner}/${parsed.repo}`;
}
