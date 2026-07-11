import type { ParsedGitHubUrl } from "@/lib/scanner/types";

const GITHUB_HOST = "github.com";

function normalizeInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed.replace(/^\/+/, "")}`;
  }
  return trimmed;
}

export function parseGitHubUrl(input: string): ParsedGitHubUrl | null {
  const normalized = normalizeInput(input);
  if (!normalized) return null;

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "");
  if (host !== GITHUB_HOST) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, "");

  if (!owner || !repo) return null;
  if (["tree", "blob", "commits", "pull", "issues"].includes(repo)) return null;

  let branch: string | undefined;

  if (segments[2] === "tree" && segments[3]) {
    branch = decodeURIComponent(segments.slice(3).join("/"));
  }

  return { owner, repo, branch };
}

export function buildRepoUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}`;
}

export function isValidGitHubUrl(input: string): boolean {
  return parseGitHubUrl(input) !== null;
}
