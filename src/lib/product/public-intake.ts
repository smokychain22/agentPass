import { parseGitHubUrl, buildRepoUrl } from "@/lib/github/parse-github-url";
import { isPublicGitHubRepository } from "@/lib/github/fetch-repo-zip";
import { fetchBranchCommitSha } from "@/lib/github/fetch-repo-zip";
import { customerError, type CustomerErrorResponse } from "./customer-errors";
import {
  classifyPrimaryLanguage,
  unsupportedRepositoryResponse,
  type UnsupportedRepositoryResponse,
} from "./support-matrix";
import { PUBLIC_CAPACITY_LIMITS, capacityLimitResponse } from "./capacity-limits";

export interface PublicIntakeRequest {
  repositoryUrl: string;
  branch?: string;
  projectRoot?: string;
  objective?: string;
  requiredCommands?: string[];
}

export interface PublicIntakeSuccess {
  ok: true;
  owner: string;
  name: string;
  repository: string;
  branch: string;
  projectRoot: string;
  sourceCommit: string;
  repositoryVisible: boolean;
  repositoryIsPublic: boolean;
  canonicalUrl: string;
}

export type PublicIntakeResult =
  | PublicIntakeSuccess
  | { ok: false; error: CustomerErrorResponse | UnsupportedRepositoryResponse | ReturnType<typeof capacityLimitResponse> };

const BLOCKED_SCHEMES = /^(file|ftp|git|ssh|http):/i;

export function validateGitHubRepositoryUrl(raw: string): {
  ok: true;
  owner: string;
  name: string;
  branch?: string;
} | { ok: false; error: CustomerErrorResponse } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: customerError({
        code: "INVALID_INPUT",
        message: "repository URL is required.",
        retryable: false,
        requiredAction: "PROVIDE_REPOSITORY_URL",
      }),
    };
  }
  if (BLOCKED_SCHEMES.test(trimmed) || trimmed.includes("://") && !trimmed.toLowerCase().includes("https://")) {
    return {
      ok: false,
      error: customerError({
        code: "INVALID_INPUT",
        message: "Only HTTPS github.com repository URLs are accepted.",
        retryable: false,
        requiredAction: "PROVIDE_HTTPS_GITHUB_URL",
      }),
    };
  }
  if (/[@:]/.test(trimmed) && !trimmed.includes("github.com")) {
    return {
      ok: false,
      error: customerError({
        code: "INVALID_INPUT",
        message: "SSH and non-GitHub remotes are not accepted.",
        retryable: false,
        requiredAction: "PROVIDE_HTTPS_GITHUB_URL",
      }),
    };
  }
  if (trimmed.includes("..") || trimmed.includes("%2e%2e")) {
    return {
      ok: false,
      error: customerError({
        code: "INVALID_INPUT",
        message: "Path traversal is not allowed in repository URLs.",
        retryable: false,
        requiredAction: "PROVIDE_CANONICAL_GITHUB_URL",
      }),
    };
  }

  const parsed = parseGitHubUrl(trimmed);
  if (!parsed) {
    return {
      ok: false,
      error: customerError({
        code: "INVALID_INPUT",
        message: "Invalid GitHub URL. Use https://github.com/owner/repository.",
        retryable: false,
        requiredAction: "PROVIDE_CANONICAL_GITHUB_URL",
      }),
    };
  }
  return { ok: true, owner: parsed.owner, name: parsed.repo, branch: parsed.branch };
}

export async function runPublicRepositoryIntake(
  input: PublicIntakeRequest
): Promise<PublicIntakeResult> {
  const validated = validateGitHubRepositoryUrl(input.repositoryUrl);
  if (!validated.ok) return validated;

  const branch = input.branch?.trim() || validated.branch || "main";
  const projectRoot = input.projectRoot?.trim() || ".";

  if (projectRoot.includes("..") || projectRoot.startsWith("/") || projectRoot.includes("\\")) {
    return {
      ok: false,
      error: customerError({
        code: "INVALID_INPUT",
        message: "projectRoot must be a relative path within the repository.",
        retryable: false,
        requiredAction: "PROVIDE_SAFE_PROJECT_ROOT",
      }),
    };
  }

  const isPublic = await isPublicGitHubRepository(validated.owner, validated.name);
  const sourceCommit = await fetchBranchCommitSha(validated.owner, validated.name, branch);
  if (!sourceCommit) {
    return {
      ok: false,
      error: customerError({
        code: "BRANCH_MISSING",
        message: `Branch "${branch}" was not found or the repository is not readable.`,
        retryable: false,
        requiredAction: isPublic ? "CHECK_BRANCH_NAME" : "INSTALL_GITHUB_APP",
        paymentState: "not_required",
      }),
    };
  }

  return {
    ok: true,
    owner: validated.owner,
    name: validated.name,
    repository: `${validated.owner}/${validated.name}`,
    branch,
    projectRoot,
    sourceCommit,
    repositoryVisible: true,
    repositoryIsPublic: isPublic,
    canonicalUrl: buildRepoUrl(validated.owner, validated.name),
  };
}

export function evaluateLanguageSupport(extCounts: Record<string, number>): PublicIntakeResult | null {
  const { supported } = classifyPrimaryLanguage(extCounts);
  if (!supported) {
    return {
      ok: false,
      error: unsupportedRepositoryResponse(
        "Primary project language is not currently supported. RepoDiet analyzes JavaScript/TypeScript repositories."
      ),
    };
  }
  return null;
}

export function evaluateArchiveCapacity(downloadedBytes: number): PublicIntakeResult | null {
  if (downloadedBytes > PUBLIC_CAPACITY_LIMITS.maxArchiveBytes) {
    return {
      ok: false,
      error: capacityLimitResponse({
        code: "ARCHIVE_TOO_LARGE",
        message: `Repository archive exceeds the ${PUBLIC_CAPACITY_LIMITS.maxArchiveBytes} byte public scan limit.`,
        limit: PUBLIC_CAPACITY_LIMITS.maxArchiveBytes,
        actual: downloadedBytes,
        requiredAction: "SPLIT_BY_PROJECT_ROOT",
      }),
    };
  }
  return null;
}

export { PUBLIC_CAPACITY_LIMITS };
