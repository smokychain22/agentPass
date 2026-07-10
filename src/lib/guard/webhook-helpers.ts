import { MANIFEST_PATHS, type GuardTrigger } from "./types";

const MANIFEST_SET = new Set<string>(MANIFEST_PATHS);

export function shouldScanForPush(input: {
  changedFiles: string[];
  previousFileCount?: number;
  currentFileCount?: number;
  fileCountIncreaseThreshold?: number;
}): { scan: boolean; trigger?: GuardTrigger; reason?: string } {
  const normalized = input.changedFiles.map((f) => f.replace(/\\/g, "/"));

  const manifestChanged = normalized.some((f) =>
    MANIFEST_SET.has(f.split("/").pop() ?? f)
  );
  if (manifestChanged) {
    return { scan: true, trigger: "manifest_changed", reason: "Dependency manifest changed." };
  }

  const threshold = input.fileCountIncreaseThreshold ?? 25;
  if (
    input.previousFileCount != null &&
    input.currentFileCount != null &&
    input.currentFileCount - input.previousFileCount >= threshold
  ) {
    return {
      scan: true,
      trigger: "file_count_increase",
      reason: `Source file count increased by ${input.currentFileCount - input.previousFileCount}.`,
    };
  }

  if (normalized.length === 0) {
    return { scan: false, reason: "No changed files in webhook payload." };
  }

  const trivialOnly = normalized.every(
    (f) =>
      f.endsWith(".md") ||
      f.endsWith(".txt") ||
      f.startsWith(".github/") ||
      f.endsWith(".json") && !MANIFEST_SET.has(f.split("/").pop() ?? "")
  );
  if (trivialOnly && normalized.length <= 3) {
    return { scan: false, reason: "Minor documentation-only change — scan skipped." };
  }

  return { scan: true, trigger: "push_default_branch", reason: "Default branch push with meaningful changes." };
}

export function extractChangedFilesFromPush(payload: Record<string, unknown>): string[] {
  const commits = payload.commits;
  if (!Array.isArray(commits)) return [];
  const files = new Set<string>();
  for (const commit of commits) {
    if (!commit || typeof commit !== "object") continue;
    const c = commit as Record<string, unknown>;
    for (const key of ["modified", "added", "removed"]) {
      const list = c[key];
      if (Array.isArray(list)) {
        for (const f of list) {
          if (typeof f === "string") files.add(f);
        }
      }
    }
  }
  return [...files];
}

export function repositoryFromGitHubPayload(payload: Record<string, unknown>): {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
} | null {
  const repo = payload.repository;
  if (!repo || typeof repo !== "object") return null;
  const r = repo as Record<string, unknown>;
  const fullName = typeof r.full_name === "string" ? r.full_name : null;
  const owner =
    typeof r.owner === "object" && r.owner && typeof (r.owner as { login?: string }).login === "string"
      ? (r.owner as { login: string }).login
      : fullName?.split("/")[0];
  const name = typeof r.name === "string" ? r.name : fullName?.split("/")[1];
  const defaultBranch = typeof r.default_branch === "string" ? r.default_branch : "main";
  if (!owner || !name) return null;
  return { owner, name, fullName: fullName ?? `${owner}/${name}`, defaultBranch };
}

export function commitShaFromPayload(
  event: string,
  payload: Record<string, unknown>
): string | null {
  if (event === "push" && typeof payload.after === "string") {
    return payload.after;
  }
  if (event === "pull_request") {
    const pr = payload.pull_request;
    if (pr && typeof pr === "object" && typeof (pr as { merge_commit_sha?: string }).merge_commit_sha === "string") {
      return (pr as { merge_commit_sha: string }).merge_commit_sha;
    }
  }
  return null;
}

export function isPullRequestMerged(payload: Record<string, unknown>): boolean {
  const pr = payload.pull_request;
  if (!pr || typeof pr !== "object") return false;
  const action = payload.action;
  return action === "closed" && (pr as { merged?: boolean }).merged === true;
}
