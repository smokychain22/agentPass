/**
 * Bounded A2MCP preflight — validate request shape and repository reachability
 * BEFORE returning HTTP 402. Never runs the full scan.
 */

import { createHash } from "node:crypto";

export const A2MCP_MAX_FINDINGS_HARD_CAP = 10;
export const A2MCP_SUPPORTED_OPERATION = "analyze_repository" as const;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "169.254.169.254",
]);

export interface A2mcpPreflightInput {
  operation?: unknown;
  repositoryUrl?: unknown;
  branch?: unknown;
  maximumFindings?: unknown;
}

export interface A2mcpPreflightSuccess {
  ok: true;
  operation: typeof A2MCP_SUPPORTED_OPERATION;
  repositoryUrl: string;
  owner: string;
  repo: string;
  branch: string;
  maximumFindings: number;
  /** Immutable commit SHA when resolvable; otherwise null (still payable only if reachable). */
  commitSha: string | null;
  normalizedRepository: string;
  requestIdentityHash: string;
}

export interface A2mcpPreflightFailure {
  ok: false;
  status: number;
  code:
    | "INVALID_INPUT"
    | "UNSUPPORTED_OPERATION"
    | "UNSUPPORTED_REPOSITORY"
    | "REPOSITORY_UNREACHABLE"
    | "SSRF_BLOCKED"
    | "BRANCH_INVALID";
  message: string;
}

export type A2mcpPreflightResult = A2mcpPreflightSuccess | A2mcpPreflightFailure;

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  // IPv4 private / link-local
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

export function normalizePublicGitHubRepositoryUrl(raw: string): {
  ok: true;
  url: string;
  owner: string;
  repo: string;
} | { ok: false; code: A2mcpPreflightFailure["code"]; message: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, code: "UNSUPPORTED_REPOSITORY", message: "repositoryUrl is not a valid URL." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, code: "UNSUPPORTED_REPOSITORY", message: "Only https://github.com repositories are supported." };
  }
  if (isPrivateOrLocalHostname(parsed.hostname)) {
    return { ok: false, code: "SSRF_BLOCKED", message: "Repository host is not allowed." };
  }
  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") {
    return {
      ok: false,
      code: "UNSUPPORTED_REPOSITORY",
      message: "Only public https://github.com/owner/repo repositories are supported.",
    };
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    return {
      ok: false,
      code: "UNSUPPORTED_REPOSITORY",
      message: "repositoryUrl must be https://github.com/owner/repo.",
    };
  }
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    return { ok: false, code: "UNSUPPORTED_REPOSITORY", message: "Invalid GitHub owner/repo." };
  }
  return {
    ok: true,
    url: `https://github.com/${owner}/${repo}`,
    owner,
    repo,
  };
}

function isValidBranchRef(branch: string): boolean {
  if (!branch || branch.length > 255) return false;
  if (branch.startsWith("/") || branch.endsWith("/") || branch.includes("..")) return false;
  if (branch.includes("\0") || branch.includes(" ")) return false;
  return /^[\w./@~+-]+$/.test(branch);
}

async function resolveCommitSha(
  owner: string,
  repo: string,
  branch: string
): Promise<{ ok: true; sha: string | null } | { ok: false; status: number; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`;
    const res = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "RepoDiet-A2MCP-Preflight",
      },
      signal: controller.signal,
      redirect: "manual",
    });
    if (res.status === 404) {
      // Distinguish missing repo vs missing branch via repo endpoint.
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "RepoDiet-A2MCP-Preflight",
        },
        signal: controller.signal,
      });
      if (repoRes.status === 404) {
        return {
          ok: false,
          status: 422,
          message: "Repository is unreachable or private. Only public repositories are supported for A2MCP Quick Triage.",
        };
      }
      return { ok: false, status: 422, message: `Branch or ref '${branch}' was not found.` };
    }
    if (res.status === 403 || res.status === 401) {
      return {
        ok: false,
        status: 422,
        message: "Repository is inaccessible. Only public repositories are supported for A2MCP Quick Triage.",
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: 422,
        message: `Repository preflight failed (GitHub HTTP ${res.status}).`,
      };
    }
    const json = (await res.json()) as { sha?: string };
    return { ok: true, sha: typeof json.sha === "string" ? json.sha : null };
  } catch {
    return {
      ok: false,
      status: 422,
      message: "Repository preflight could not reach GitHub. Try again or check the URL.",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function preflightA2mcpQuickTriage(
  input: A2mcpPreflightInput,
  options?: { resolveCommit?: boolean }
): Promise<A2mcpPreflightResult> {
  const resolveCommit = options?.resolveCommit !== false;

  if (input.operation !== undefined && input.operation !== A2MCP_SUPPORTED_OPERATION) {
    return {
      ok: false,
      status: 400,
      code: "UNSUPPORTED_OPERATION",
      message: `operation must be '${A2MCP_SUPPORTED_OPERATION}'.`,
    };
  }

  const repositoryUrlRaw =
    typeof input.repositoryUrl === "string" ? input.repositoryUrl.trim() : "";
  if (!repositoryUrlRaw) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_INPUT",
      message: "repositoryUrl is required.",
    };
  }

  const normalized = normalizePublicGitHubRepositoryUrl(repositoryUrlRaw);
  if (!normalized.ok) {
    return {
      ok: false,
      status: normalized.code === "SSRF_BLOCKED" ? 400 : 422,
      code: normalized.code,
      message: normalized.message,
    };
  }

  const branch =
    typeof input.branch === "string" && input.branch.trim()
      ? input.branch.trim()
      : "main";
  if (!isValidBranchRef(branch)) {
    return {
      ok: false,
      status: 400,
      code: "BRANCH_INVALID",
      message: "branch/ref format is invalid.",
    };
  }

  const maximumFindingsRaw = input.maximumFindings;
  const maximumFindings =
    maximumFindingsRaw === undefined ? 3 : Number(maximumFindingsRaw);
  if (
    !Number.isFinite(maximumFindings) ||
    maximumFindings < 1 ||
    maximumFindings > A2MCP_MAX_FINDINGS_HARD_CAP
  ) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_INPUT",
      message: `maximumFindings must be a number between 1 and ${A2MCP_MAX_FINDINGS_HARD_CAP}.`,
    };
  }

  let commitSha: string | null = null;
  if (resolveCommit) {
    const resolved = await resolveCommitSha(normalized.owner, normalized.repo, branch);
    if (!resolved.ok) {
      return {
        ok: false,
        status: resolved.status,
        code: "REPOSITORY_UNREACHABLE",
        message: resolved.message,
      };
    }
    commitSha = resolved.sha;
  }

  const cappedFindings = Math.floor(maximumFindings);
  const identityPayload = {
    operation: A2MCP_SUPPORTED_OPERATION,
    repositoryUrl: normalized.url,
    branch,
    commitSha,
    maximumFindings: cappedFindings,
  };
  const requestIdentityHash = `sha256:${createHash("sha256")
    .update(JSON.stringify(identityPayload))
    .digest("hex")}`;

  return {
    ok: true,
    operation: A2MCP_SUPPORTED_OPERATION,
    repositoryUrl: normalized.url,
    owner: normalized.owner,
    repo: normalized.repo,
    branch,
    maximumFindings: cappedFindings,
    commitSha,
    normalizedRepository: `${normalized.owner}/${normalized.repo}`,
    requestIdentityHash,
  };
}
