/**
 * Best-effort parser for `onchainos agent common context`'s stdout.
 *
 * Unlike `next-action` (a fixed, CLI-generated script) or `agent status`
 * (documented, stable label lines — see `parseTaskStatus`), `common context`
 * is explicitly documented as printing "a structured natural-language
 * description for the LLM" — prose, not a guaranteed machine format. This
 * parser is deliberately permissive about *where* a field appears and
 * deliberately strict about *never inventing* one: a field it cannot find
 * with confidence comes back `undefined`, and the caller (the deterministic
 * job_accepted turn) treats a missing repository URL as a hard stop rather
 * than guessing — the one piece of data here that gates cloning and writing
 * to a real GitHub repository must never be a guess.
 */

export interface TaskContextFields {
  title?: string;
  description?: string;
  tokenAmount?: string;
  tokenSymbol?: string;
  repositoryUrl?: string;
  buyerAgentId?: string;
}

function firstMatch(stdout: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(stdout);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

/**
 * Strips trailing sentence punctuation from a URL captured by `\S+`.
 *
 * Buyers write the repository into PROSE, not into a field. The live task
 * detail for job 0x22a2… reads:
 *
 *   "Repository: https://github.com/velz-cmd/repodiet-e2e-test. Do not push
 *    directly to the default branch."
 *
 * `\S+` is greedy to the whitespace, so it captured the sentence period and
 * yielded `repo: "repodiet-e2e-test."` — a repository that does not exist.
 * Every GitHub call for that job therefore 404'd, the deterministic turn
 * failed, and the accepted, escrow-funded task was never delivered.
 *
 * Closing bracket characters get the same treatment: a URL inside "(see
 * https://github.com/a/b)" has the same problem. A trailing slash is NOT
 * stripped here — it is legitimate in a URL and `parseGitHubUrl` handles it.
 */
function trimTrailingSentencePunctuation(url: string): string {
  return url.replace(/[.,;:!?)\]}>'"]+$/, "");
}

export function parseTaskContext(stdout: string): TaskContextFields {
  const rawRepositoryUrl = firstMatch(stdout, [
    /repository=(https?:\/\/\S+)/i,
    /repository(?:\s+url)?[:\s]+(https?:\/\/\S+)/i,
  ]);
  const repositoryUrl = rawRepositoryUrl
    ? trimTrailingSentencePunctuation(rawRepositoryUrl)
    : undefined;

  const title = firstMatch(stdout, [/title[:\s]+"?([^"\n]+?)"?(?:\n|$)/i]);
  const description = firstMatch(stdout, [/description[:\s]+"?([^"\n]+?)"?(?:\n|$)/i]);
  const tokenAmount = firstMatch(stdout, [/token\s*amount[:\s]+([0-9.]+)/i, /budget[:\s]+([0-9.]+)/i]);
  const tokenSymbol = firstMatch(stdout, [/token\s*symbol[:\s]+(\w+)/i, /budget[:\s]+[0-9.]+\s+(\w+)/i]);
  const buyerAgentId = firstMatch(stdout, [/buyer\s*agent\s*id[:\s]+#?(\d+)/i, /\bclient(?:AgentId)?[:\s]+#?(\d+)/i]);

  return { title, description, tokenAmount, tokenSymbol, repositoryUrl, buyerAgentId };
}
