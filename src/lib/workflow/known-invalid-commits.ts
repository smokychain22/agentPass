/** Commits with known malformed source (Meridian RepoDiet PR #14 regression). */
const KNOWN_BASELINE_INVALID_COMMITS = new Set([
  "a39937b4b05691a7cc57f2824f18745dd61bea3f",
]);

const KNOWN_BASELINE_INVALID_PREFIXES = ["a39937b4"];

export function isKnownBaselineInvalidCommit(commitSha: string): boolean {
  const normalized = commitSha.trim().toLowerCase();
  if (KNOWN_BASELINE_INVALID_COMMITS.has(normalized)) return true;
  return KNOWN_BASELINE_INVALID_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function repositoryCommitUrl(input: {
  owner: string;
  name: string;
  commitSha: string;
}): string {
  return `https://github.com/${input.owner}/${input.name}/commit/${input.commitSha}`;
}
