/**
 * Builds the `--service-params` string for an A2A repository-cleanup task,
 * so future task/`set-asp` creation goes through one canonical builder
 * instead of a hand-typed string.
 *
 * `task-context-fetcher.ts`'s `parseTaskContext` only recognizes a
 * repository URL immediately preceded by `repository=` or `repository:` —
 * deliberately, since it never guesses a URL out of free prose. Job
 * 0xba4de4f576f0dbb05b0a88d2d889102dfb134f5e1c901bf0534312daf5d33402 has 1
 * USDT escrowed and undeliverable because its `--service-params` was
 * hand-typed as `repositoryUrl: <url>; base: ...; constraints: ...` — close
 * enough to read, but not the exact `repository=<url>` token the parser
 * requires, and the task has since passed OPEN so it can never be corrected.
 * That mistake is only possible when the string is typed by hand. This
 * function makes it structurally impossible for any future job created
 * through this codebase.
 */

export interface RepositoryCleanupServiceParamsInput {
  /** Must be a bare `https://github.com/<owner>/<repo>` URL — no trailing path, query, or prose. */
  repositoryUrl: string;
  /** Base branch the cleanup PR targets. Informational only — the parser has no field for it. */
  baseBranch?: string;
  /** Free-text constraints for the ASP. Informational only — the parser has no field for it. */
  constraints?: string;
}

const BARE_GITHUB_REPO_URL = /^https:\/\/github\.com\/[^\s/]+\/[^\s/]+$/;

export function buildRepositoryCleanupServiceParams(
  input: RepositoryCleanupServiceParamsInput
): string {
  if (!BARE_GITHUB_REPO_URL.test(input.repositoryUrl)) {
    throw new Error(
      `buildRepositoryCleanupServiceParams: repositoryUrl must be a bare https://github.com/<owner>/<repo> URL with no trailing path, query, or trailing slash — got: ${JSON.stringify(input.repositoryUrl)}`
    );
  }

  const parts = [`repository=${input.repositoryUrl}`];
  if (input.baseBranch?.trim()) parts.push(`base=${input.baseBranch.trim()}`);
  if (input.constraints?.trim()) parts.push(`constraints=${input.constraints.trim()}`);
  return parts.join("; ");
}
